export interface ServerEvents {
  // ... existing events ...
  'doc-server-started': () => void;
  'doc-server-stopped': () => void;
} 