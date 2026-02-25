/**
 * Annotation Operations for undo/redo support
 *
 * These operations work with annotation elements stored in CanvasEngine's
 * annotation store, separate from the DocumentTree (which is for components).
 */

import type { AnnotationElement } from '../../../../shared/types/annotations';
import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import { BaseOperation } from './Operation';

/**
 * Interface for annotation storage.
 * Each mutator (add/update/remove/removeBatch) triggers a server request.
 * replaceAll is local-only (for undo/redo and load/reload).
 */
export interface AnnotationStore {
  getAll(): AnnotationElement[];
  get(id: string): AnnotationElement | undefined;
  add(annotation: AnnotationElement): void;
  update(id: string, updates: Partial<AnnotationElement>): void;
  remove(id: string): void;
  removeBatch(ids: string[]): void;
  replaceAll(annotations: AnnotationElement[]): void;
}

/**
 * Insert new annotation
 */
export interface AnnotationInsertParams {
  annotation: AnnotationElement;
  store: AnnotationStore;
}

export class AnnotationInsertOperation extends BaseOperation {
  name = 'AnnotationInsert';
  private params: AnnotationInsertParams;

  constructor(params: AnnotationInsertParams) {
    super();
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    try {
      this.params.store.add(this.params.annotation);
      return this.success([this.params.annotation.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  undo(_tree: DocumentTree): OperationResult {
    try {
      this.params.store.remove(this.params.annotation.id);
      return this.success([this.params.annotation.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}

/**
 * Update existing annotation
 */
export interface AnnotationUpdateParams {
  id: string;
  updates: Partial<AnnotationElement>;
  store: AnnotationStore;
}

export class AnnotationUpdateOperation extends BaseOperation {
  name = 'AnnotationUpdate';
  private params: AnnotationUpdateParams;
  private oldAnnotation: AnnotationElement | null = null;

  constructor(params: AnnotationUpdateParams) {
    super();
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    try {
      const existing = this.params.store.get(this.params.id);
      if (!existing) {
        return this.error(`Annotation "${this.params.id}" not found`);
      }

      // Store old state for undo
      this.oldAnnotation = { ...existing };

      this.params.store.update(this.params.id, this.params.updates);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  undo(_tree: DocumentTree): OperationResult {
    if (!this.oldAnnotation) {
      return this.error('No old annotation to restore');
    }

    try {
      // Restore the full old annotation via update
      this.params.store.update(this.params.id, this.oldAnnotation);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}

/**
 * Delete annotation
 */
export interface AnnotationDeleteParams {
  id: string;
  store: AnnotationStore;
}

export class AnnotationDeleteOperation extends BaseOperation {
  name = 'AnnotationDelete';
  private params: AnnotationDeleteParams;
  private deletedAnnotation: AnnotationElement | null = null;

  constructor(params: AnnotationDeleteParams) {
    super();
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    try {
      const existing = this.params.store.get(this.params.id);
      if (!existing) {
        return this.error(`Annotation "${this.params.id}" not found`);
      }

      // Store for undo
      this.deletedAnnotation = { ...existing };

      this.params.store.remove(this.params.id);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  undo(_tree: DocumentTree): OperationResult {
    if (!this.deletedAnnotation) {
      return this.error('No deleted annotation to restore');
    }

    try {
      this.params.store.add(this.deletedAnnotation);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}

/**
 * Batch delete multiple annotations
 */
export interface AnnotationBatchDeleteParams {
  ids: string[];
  store: AnnotationStore;
}

export class AnnotationBatchDeleteOperation extends BaseOperation {
  name = 'AnnotationBatchDelete';
  private params: AnnotationBatchDeleteParams;
  private deletedAnnotations: AnnotationElement[] = [];

  constructor(params: AnnotationBatchDeleteParams) {
    super();
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    try {
      // Store deleted annotations for undo
      this.deletedAnnotations = this.params.ids
        .map((id) => this.params.store.get(id))
        .filter((a): a is AnnotationElement => a !== undefined)
        .map((a) => ({ ...a }));

      this.params.store.removeBatch(this.params.ids);
      return this.success(this.params.ids);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  undo(_tree: DocumentTree): OperationResult {
    if (this.deletedAnnotations.length === 0) {
      return this.error('No deleted annotations to restore');
    }

    try {
      for (const annotation of this.deletedAnnotations) {
        this.params.store.add(annotation);
      }
      return this.success(this.params.ids);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}

/**
 * Move annotation (for dragging)
 * Stores complete old and new positions for proper undo
 */
export interface AnnotationMoveParams {
  id: string;
  oldPosition: Partial<AnnotationElement>;
  newPosition: Partial<AnnotationElement>;
  store: AnnotationStore;
}

export class AnnotationMoveOperation extends BaseOperation {
  name = 'AnnotationMove';
  private params: AnnotationMoveParams;

  constructor(params: AnnotationMoveParams) {
    super();
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    try {
      const existing = this.params.store.get(this.params.id);
      if (!existing) {
        return this.error(`Annotation "${this.params.id}" not found`);
      }

      this.params.store.update(this.params.id, this.params.newPosition);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  undo(_tree: DocumentTree): OperationResult {
    try {
      const existing = this.params.store.get(this.params.id);
      if (!existing) {
        return this.error(`Annotation "${this.params.id}" not found`);
      }

      this.params.store.update(this.params.id, this.params.oldPosition);
      return this.success([this.params.id]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }
}
