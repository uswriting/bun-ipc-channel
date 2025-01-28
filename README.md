# README  

**bun-ipc-channel**  
A minimal, message-oriented IPC layer for Bun. Drop this code into your project to enable structured request/response and event-driven communication between Bun processes.  

---

### Table of Contents  
| Section | Description |  
|---------|-------------|  
| [Overview](#overview) | Key features and purpose |  
| [Usage](#usage) | Quick start guide |  
| [API Reference](#api-reference) | Methods and properties |  
| [Error Handling](#error-handling) | Error types and behavior |  
| [Compatibility](#compatibility) | System requirements |  
| [License](#license) | Usage rights |  

---

## Overview  

| Feature | Description |  
|---------|-------------|  
| **Bidirectional Communication** | Send and receive messages between processes. |  
| **Type-Safe Events** | Define request/response types for each event. |  
| **Timeout Support** | Configurable request timeouts. |  
| **Error Propagation** | Structured error handling with `IPCError`. |  
| **No Dependencies** | Copy-paste integration. |  

---

## Usage  

### 1. Add the Code  
Copy `channel.ts` into your project.  

### 2. Define Your Events  
```typescript  
interface MyEvents {  
  calculate: { request: { a: number; b: number }; response: number };  
  log: { request: string; response?: undefined };  
}  
```  

### 3. Parent Process  
```typescript  
import { spawnWithIPC } from './channel';  

const { process, ipc } = spawnWithIPC<MyEvents>(['bun', 'child.ts']);  

// Send a request  
const result = await ipc.send('calculate', { a: 2, b: 3 });  

// Send a notification  
ipc.notify('log', 'Calculation completed');  
```  

### 4. Child Process  
```typescript  
import { createChildIPC } from './channel';  

const ipc = createChildIPC<MyEvents>();  
ipc.on('calculate', ({ a, b }) => a + b);  
```  

---

## API Reference  

### `IPCChannel<T extends EventMap>`  

| Method | Description | Parameters | Returns |  
|--------|-------------|------------|---------|  
| `.send(event, data, options?)` | Request/response pattern. | `event: K`, `data: T[K]["request"]`, `options?: { timeout?: number }` | `Promise<T[K]["response"]>` |  
| `.notify(event, data)` | Fire-and-forget notification. | `event: K`, `data: T[K]["request"]` | `void` |  
| `.on(event, handler)` | Register event handlers. | `event: K`, `handler: (data: T[K]["request"]) => Promise<T[K]["response"]> \| T[K]["response"]` | `void` |  
| `.setDefaultTimeout(ms)` | Set global timeout for requests. | `ms: number` | `void` |  

---

## Error Handling  

| Error Kind | Description |  
|------------|-------------|  
| `Timeout` | Request exceeded timeout duration. |  
| `ChannelClosed` | IPC channel closed unexpectedly. |  
| `InvalidOperation` | Invalid operation attempted. |  
| `HandlerNotFound` | No handler registered for event. |  
| `Execution` | Error in handler execution. |  
| `Unknown` | Unclassified error type. |  

Errors are propagated as `IPCError` instances with a `kind` property for categorization.  

---

## Compatibility  

| Requirement | Details |  
|-------------|---------|  
| **Runtime** | Bun v1.2+ |  
| **System** | Designed for Bun’s `spawn` IPC system |  

---

## License  

| License Type | Usage Rights |  
|--------------|--------------|  
| MIT | Free to use, modify, and distribute. |  

---

**Note**  
This is not an NPM package. Copy the code into your project and modify as needed.  

--- 

**Maintenance Log**  

| Date | Version | Changes |  
|------|---------|---------|  
| 2025-01-29 | 1.0.0 | Published. |  

--- 
