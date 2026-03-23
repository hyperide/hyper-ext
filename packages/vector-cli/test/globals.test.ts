import { describe, expect, it } from 'bun:test';
import { ChainableNode } from '../src/chainable';
import { createContext } from '../src/context';
import { createGlobals } from '../src/globals';

describe('global functions', () => {
  it('should create rect', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const node = g.rect(100, 50);
    expect(node).toBeInstanceOf(ChainableNode);
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should create circle', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.circle(30);
    expect(ctx.graph.nodeCount).toBe(1);
  });

  it('should create all generator types', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.rect(100, 50);
    g.ellipse(30, 20);
    g.circle(10);
    g.polygon(6, 30);
    g.star(5, 40, 20);
    g.line(0, 0, 100, 100);
    g.arc(50, 0, 180);
    g.spiral(3, 50);
    g.arrow(100, 20);
    g.path('M 0 0 L 100 0 Z');
    g.text('Hello', 24);
    g.mesh(2, 2);
    expect(ctx.graph.nodeCount).toBe(12);
  });

  it('should do boolean union', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const a = g.rect(100, 100);
    const b = g.circle(50);
    const u = g.union(a, b);
    expect(u).toBeInstanceOf(ChainableNode);
    expect(ctx.graph.nodeCount).toBe(3);
    expect(ctx.graph.edgeCount).toBe(2);
  });

  it('should do all boolean ops', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const a = g.rect(100, 100);
    const b = g.circle(50);
    g.subtract(a, b);
    expect(ctx.graph.nodeCount).toBe(3);
  });

  it('should create group', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const a = g.rect(50, 50);
    const b = g.circle(20);
    const grp = g.group(a, b);
    expect(grp).toBeInstanceOf(ChainableNode);
    expect(ctx.graph.nodeCount).toBe(3);
  });

  it('should set canvas size', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.canvas(200, 300);
    expect(ctx.canvasWidth).toBe(200);
    expect(ctx.canvasHeight).toBe(300);
  });

  it('should get canvas size when no args', () => {
    const ctx = createContext(150, 250);
    const g = createGlobals(ctx);
    const size = g.canvas();
    expect(size.width).toBe(150);
    expect(size.height).toBe(250);
  });

  it('should mute/unmute/toggle', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const r = g.rect(100, 50);
    expect(ctx.graph.isMuted(r.nodeId)).toBe(false);
    g.mute(r);
    expect(ctx.graph.isMuted(r.nodeId)).toBe(true);
    g.unmute(r);
    expect(ctx.graph.isMuted(r.nodeId)).toBe(false);
    g.toggle(r);
    expect(ctx.graph.isMuted(r.nodeId)).toBe(true);
  });

  it('should set param', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const r = g.rect(100, 50);
    g.set(r, 'width', 200);
    expect(ctx.graph.getNode(r.nodeId)?.params.width).toBe(200);
  });

  it('should remove node', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    const r = g.rect(100, 50);
    expect(ctx.graph.nodeCount).toBe(1);
    g.remove(r);
    expect(ctx.graph.nodeCount).toBe(0);
  });

  it('should list nodes', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    g.rect(100, 50);
    g.circle(30);
    const nodeList = g.nodes();
    expect(nodeList.length).toBe(2);
  });

  it('should have Math and console', () => {
    const ctx = createContext();
    const g = createGlobals(ctx);
    expect(g.Math).toBe(Math);
    expect(g.console).toBe(console);
  });
});
