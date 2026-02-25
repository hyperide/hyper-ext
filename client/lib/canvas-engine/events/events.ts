/**
 * Event types for Canvas Engine
 */

import type { ComponentInstance, HistoryState, SelectionState } from "../models/types";

/**
 * Instance events
 */
export interface InstanceInsertEvent {
  instance: ComponentInstance;
}

export interface InstanceUpdateEvent {
  id: string;
  props: Record<string, any>;
  oldProps: Record<string, any>;
}

export interface InstanceDeleteEvent {
  id: string;
  instance: ComponentInstance;
}

export interface InstanceMoveEvent {
  id: string;
  oldParentId: string | null;
  newParentId: string | null;
  oldIndex: number;
  newIndex: number;
}

export interface InstanceDuplicateEvent {
  originalId: string;
  newId: string;
  instance: ComponentInstance;
}

/**
 * Selection events
 */
export interface SelectionChangeEvent {
  selectedIds: string[];
  previousIds: string[];
}

export interface HoverChangeEvent {
  hoveredId: string | null;
  previousId: string | null;
}

/**
 * Mode events
 */
export interface ModeChangeEvent {
  mode: 'design' | 'interact' | 'code';
  previousMode: 'design' | 'interact' | 'code';
}

/**
 * History events
 */
export interface HistoryChangeEvent {
  state: HistoryState;
}

export interface UndoEvent {
  operationName: string;
}

export interface RedoEvent {
  operationName: string;
}

/**
 * Tree events
 */
export interface TreeChangeEvent {
  changedIds: string[];
}

/**
 * All events map
 */
export interface CanvasEngineEvents {
  // Instance events
  "instance:insert": InstanceInsertEvent;
  "instance:update": InstanceUpdateEvent;
  "instance:delete": InstanceDeleteEvent;
  "instance:move": InstanceMoveEvent;
  "instance:duplicate": InstanceDuplicateEvent;

  // Selection events
  "selection:change": SelectionChangeEvent;
  "hover:change": HoverChangeEvent;

  // Mode events
  "mode:change": ModeChangeEvent;

  // History events
  "history:change": HistoryChangeEvent;
  "history:undo": UndoEvent;
  "history:redo": RedoEvent;

  // Tree events
  "tree:change": TreeChangeEvent;
}

/**
 * Event names
 */
export type CanvasEventName = keyof CanvasEngineEvents;

/**
 * Event listener type
 */
export type EventListener<T> = (event: T) => void;
