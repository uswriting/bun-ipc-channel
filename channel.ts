import type { SpawnOptions } from 'bun';

type SendFunction = (message: any) => void | boolean;

/**
 * union representing categories of IPC errors
 */
type ErrorKind =
  /** Request exceeded timeout duration */
  | 'timeout'
  /** Channel was closed unexpectedly */
  | 'channel-closed'
  /** Invalid operation attempted */
  | 'invalid-operation'
  /** No handler registered for event */
  | 'handler-not-found'
  /** Data serialization failure */
  | 'serialization'
  /** Error in handler execution */
  | 'execution'
  /** Unclassified error type */
  | 'unknown';

/**
 * Custom error class for IPC operations with error categorization
 * @extends Error
 */
export class IPCError extends Error {
  /**
   * Create an IPCError
   * @param message Human-readable error description
   * @param kind Error category classification
   */
  constructor(message: string, public readonly kind: ErrorKind = 'unknown') {
    super(message);
    this.name = 'IPCError';

    // Maintain proper prototype chain for stack traces
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IPCError);
    }
    Object.setPrototypeOf(this, IPCError.prototype);
  }

  /**
   * Custom JSON serialization
   * @returns Object containing error details
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      stack: this.stack,
    };
  }
}

/**
 * Options for send operations
 */
type SendOptions = {
  /** Timeout in milliseconds for the request */
  timeout?: number;
};

/**
 * Base interface for request-response events
 */
type EventBase = {
  /** Request data type */
  request: unknown;
  /** Response data type (optional) */
  response?: unknown;
};

/**
 * Mapping of event names to their request/response types
 */
type EventMap = Record<string, EventBase>;

/**
 * Message envelope structure for IPC communication
 */
type RequestEnvelope<T extends EventMap, K extends keyof T> = {
  /** Unique message identifier */
  id: string;
  /** Event name */
  event: K;
  /** Request payload */
  data: T[K]['request'];
  /** Flag indicating this is a response */
  isResponse?: boolean;
  /** Error message (present if response is an error) */
  error?: string;
  /** Error classification */
  errorKind?: ErrorKind;
};

/**
 * Handler function type for processing events
 */
type EventHandler<T, U> = (data: T) => Promise<U> | U;

/**
 * Helper type to extract events that require responses
 */
type ResponseRequiredKeys<T extends EventMap> = {
  [K in keyof T]: T[K]['response'] extends undefined ? never : K;
}[keyof T];

/**
 * Represents a pending request awaiting response
 */
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId?: Timer;
};

/**
 * Main IPC communication channel class
 * @typeparam T - Event map type defining supported events
 */
class IPCChannel<T extends EventMap> {
  private defaultTimeout = 30000;
  private pending = new Map<string, PendingRequest>();
  private handlers = new Map<keyof T, EventHandler<unknown, unknown>>();
  private exitHandlers: Array<
    (
      exitCode: number | undefined,
      signalCode: number | undefined,
      error?: Error
    ) => void
  > = [];

  /**
   * @param sendTarget - Object with send capability
   * @param registerHandler - Function to register message handler
   */
  constructor(
    private readonly sendTarget: { send: SendFunction },
    private readonly registerHandler: (handler: (message: any) => void) => void
  ) {
    this.registerHandler(this.handleMessage.bind(this));
  }

  /**
   * Set default timeout for requests
   * @param timeout - Timeout in milliseconds
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Register handler for process exit events
   * @param handler - Callback for exit events
   */
  onExit(
    handler: (
      exitCode: number | undefined,
      signalCode: number | undefined,
      error?: Error
    ) => void
  ): void {
    this.exitHandlers.push(handler);
  }

  /**
   * Handle process exit events and clean up resources
   * @param exitCode Process exit code if available
   * @param signalCode Termination signal if available
   * @param error Error object if process exited due to error
   */
  private handleExit(
    exitCode: number | undefined,
    signalCode: number | undefined,
    error?: Error
  ): void {
    // Reject all pending requests
    for (const [id, entry] of this.pending) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      entry.reject(
        new IPCError(
          `IPC channel closed - Exit code: ${exitCode}, ` +
            `Signal: ${signalCode}, ` +
            `Error: ${error?.message || 'None'}`,
          'channel-closed'
        )
      );
      this.pending.delete(id);
    }

    // Notify exit handlers
    this.exitHandlers.forEach((handler) =>
      handler(exitCode, signalCode, error)
    );
  }

  /**
   * Send a request and wait for response
   * @param event - Event name from event map
   * @param data - Request payload
   * @param options - Send configuration
   * @returns Promise resolving with response data
   * @example
   * const result = await ipc.send('add', { a: 2, b: 3 });
   */
  send<K extends ResponseRequiredKeys<T>>(
    event: K,
    data: T[K]['request'],
    options?: SendOptions
  ): Promise<T[K]['response']> {
    const id = Bun.randomUUIDv7();
    const envelope: RequestEnvelope<T, K> = { id, event, data };

    return new Promise((resolve, reject) => {
      const timeout = options?.timeout ?? this.defaultTimeout;
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new IPCError(
            `Request timeout after ${timeout}ms for event '${String(event)}'`,
            'timeout'
          )
        );
      }, timeout);

      this.pending.set(id, { resolve, reject, timeoutId });

      try {
        this.sendTarget.send(envelope);
      } catch (err) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Send a notification without waiting for response
   * @param event - Event name from event map
   * @param data - Request payload
   * @example
   * ipc.notify('log', 'Something happened');
   */
  notify<K extends keyof T>(event: K, data: T[K]['request']): void {
    const envelope: RequestEnvelope<T, K> = {
      id: Bun.randomUUIDv7(),
      event,
      data,
    };
    this.sendTarget.send(envelope);
  }

  /**
   * Register event handler
   * @param event - Event name to handle
   * @param handler - Handler function
   * @example
   * ipc.on('add', ({ a, b }) => a + b);
   */
  on<K extends keyof T>(
    event: K,
    handler: T[K]['response'] extends undefined
      ? (data: T[K]['request']) => void
      : (data: T[K]['request']) => Promise<T[K]['response']> | T[K]['response']
  ): void {
    if (this.handlers.has(event)) {
      throw new IPCError(
        `Handler for event '${String(event)}' already exists`,
        'invalid-operation'
      );
    }
    this.handlers.set(event, handler as EventHandler<any, any>);
  }

  private handleMessage(envelope: RequestEnvelope<T, keyof T>): void {
    if (envelope.isResponse) {
      this.handleResponse(envelope);
    } else {
      this.handleRequest(envelope);
    }
  }

  private handleResponse(envelope: RequestEnvelope<T, keyof T>): void {
    const pending = this.pending.get(envelope.id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pending.delete(envelope.id);

    envelope.error
      ? pending.reject(new IPCError(envelope.error, envelope.errorKind))
      : pending.resolve(envelope.data);
  }

  private async handleRequest(
    envelope: RequestEnvelope<T, keyof T>
  ): Promise<void> {
    const handler = this.handlers.get(envelope.event);

    if (!handler) {
      this.sendErrorResponse(
        envelope,
        `No handler for event '${String(envelope.event)}'`,
        'handler-not-found'
      );
      return;
    }

    try {
      const result = await handler(envelope.data);
      if (result !== undefined) {
        this.sendTarget.send({
          id: envelope.id,
          event: envelope.event,
          data: result,
          isResponse: true,
        });
      }
    } catch (error) {
      this.sendErrorResponse(
        envelope,
        this.getErrorMessage(error),
        this.getErrorKind(error)
      );
    }
  }

  private sendErrorResponse(
    envelope: RequestEnvelope<T, keyof T>,
    message: string,
    kind: ErrorKind
  ): void {
    this.sendTarget.send({
      id: envelope.id,
      event: envelope.event,
      error: message,
      errorKind: kind,
      isResponse: true,
    });
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private getErrorKind(error: unknown): ErrorKind {
    return error instanceof IPCError ? error.kind : 'execution';
  }
}

/**
 * Spawn a child process with IPC capabilities
 * @param command - Command to execute
 * @param options - Spawn options
 * @returns Object with process reference and IPC channel
 * @example
 * const { process, ipc } = spawnWithIPC<MyEvents>(['node', 'child.js'], {
 *   stdio: ['inherit', 'inherit', 'inherit']
 * });
 */
export function spawnWithIPC<T extends Record<keyof T, EventBase>>(
  command: string[],
  options?: Omit<SpawnOptions.OptionsObject, 'ipc' | 'onExit'>
): {
  process: SpawnOptions.OptionsToSubprocess<SpawnOptions.OptionsObject>;
  ipc: IPCChannel<T>;
} {
  let ipcHandler: (message: any) => void;
  const ipc = new IPCChannel<T>(
    { send: (msg) => child.send(msg) },
    (handler) => {
      ipcHandler = handler;
    }
  );

  const fullOptions: SpawnOptions.OptionsObject = {
    ...options,
    ipc: (message: any) => ipcHandler?.(message),
    onExit: (proc, exitCode, signalCode, error) => {
      ipc['handleExit'](
        exitCode ?? undefined,
        signalCode ?? undefined,
        error instanceof Error ? error : undefined
      );
    },
  };

  const child = Bun.spawn(command, fullOptions);

  return {
    process:
      child as SpawnOptions.OptionsToSubprocess<SpawnOptions.OptionsObject>,
    ipc,
  };
}

/**
 * Create IPC channel for child process
 * @returns Configured IPC channel
 * @example
 * const ipc = createChildIPC<MyEvents>();
 * ipc.on('add', ({ a, b }) => a + b);
 */
export function createChildIPC<
  T extends Record<keyof T, EventBase>
>(): IPCChannel<T> {
  return new IPCChannel<T>(
    {
      send: (msg) => {
        if (!process.send) {
          throw new IPCError(
            'Process not spawned with IPC',
            'invalid-operation'
          );
        }
        if (!process.send(msg)) {
          throw new IPCError(
            'Failed to send message - channel closed',
            'channel-closed'
          );
        }
      },
    },
    (handler) => process.on('message', handler)
  );
}

/**
 * Example event type definitions
 * @example
 * interface MyEvents {
 *   add: { request: { a: number; b: number }; response: number };
 *   ping: { request: undefined; response: string };
 *   log: { request: string; response?: undefined };
 * }
 */
export interface MyEvents {
  add: { request: { a: number; b: number }; response: number };
  ping: { request: undefined; response: string };
  log: { request: string; response?: undefined };
}
