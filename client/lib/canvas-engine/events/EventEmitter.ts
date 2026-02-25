/**
 * Type-safe EventEmitter for Canvas Engine
 */

import type { CanvasEngineEvents, CanvasEventName, EventListener } from "./events";

/**
 * Type-safe event emitter
 */
export class EventEmitter {
  private listeners: Map<
    CanvasEventName,
    Set<EventListener<any>>
  > = new Map();

  /**
   * Register event listener
   */
  on<K extends CanvasEventName>(
    event: K,
    listener: EventListener<CanvasEngineEvents[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Register one-time event listener
   */
  once<K extends CanvasEventName>(
    event: K,
    listener: EventListener<CanvasEngineEvents[K]>
  ): () => void {
    const wrapper: EventListener<CanvasEngineEvents[K]> = (data) => {
      listener(data);
      this.off(event, wrapper);
    };

    return this.on(event, wrapper);
  }

  /**
   * Unregister event listener
   */
  off<K extends CanvasEventName>(
    event: K,
    listener: EventListener<CanvasEngineEvents[K]>
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit event
   */
  emit<K extends CanvasEventName>(
    event: K,
    data: CanvasEngineEvents[K]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for "${event}":`, error);
        }
      });
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: CanvasEventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: CanvasEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Get all event names with listeners
   */
  eventNames(): CanvasEventName[] {
    return Array.from(this.listeners.keys());
  }
}
