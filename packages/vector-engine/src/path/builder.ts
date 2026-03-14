/**
 * @file Fluent path builder — used by all generator nodes to construct paths
 *
 * Accessed via: Internal module — used by all generator nodes to construct path geometry
 */

import type { PathValue } from '../types';
import { encodeCommands, PathCmd, type PathCommand } from './commands';

export class PathBuilder {
  private commands: PathCommand[] = [];
  private isClosed = false;

  moveTo(x: number, y: number): this {
    this.commands.push({ type: PathCmd.Move, x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push({ type: PathCmd.Line, x, y });
    return this;
  }

  cubicTo(cx1: number, cy1: number, cx2: number, cy2: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Cubic, cx1, cy1, cx2, cy2, x, y });
    return this;
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Quad, cx, cy, x, y });
    return this;
  }

  arcTo(rx: number, ry: number, rotation: number, largeArc: number, sweep: number, x: number, y: number): this {
    this.commands.push({ type: PathCmd.Arc, rx, ry, rotation, largeArc, sweep, x, y });
    return this;
  }

  close(): this {
    this.commands.push({ type: PathCmd.Close });
    this.isClosed = true;
    return this;
  }

  build(): PathValue {
    const result: PathValue = {
      commands: encodeCommands(this.commands),
      closed: this.isClosed,
    };
    this.commands = [];
    this.isClosed = false;
    return result;
  }
}
