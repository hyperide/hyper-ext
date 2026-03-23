import { describe, expect, it } from 'bun:test';
import { getHelp } from '../src/help';

describe('help system', () => {
  it('should return brief help with no topic', () => {
    const help = getHelp();
    expect(help).toContain('vecli');
    expect(help).toContain('Usage:');
    expect(help).toContain('--help <topic>');
    expect(help).toContain('generators');
    expect(help).toContain('examples');
  });

  it('should return generators help', () => {
    const help = getHelp('generators');
    expect(help).toContain('rect(');
    expect(help).toContain('ellipse(');
    expect(help).toContain('circle(');
    expect(help).toContain('star(');
    expect(help).toContain('path(');
    expect(help).toContain('mesh(');
  });

  it('should return style help', () => {
    const help = getHelp('style');
    expect(help).toContain('.fill(');
    expect(help).toContain('.stroke(');
    expect(help).toContain('.opacity(');
    expect(help).toContain('.shadow(');
  });

  it('should return transform help', () => {
    const help = getHelp('transform');
    expect(help).toContain('.translate(');
    expect(help).toContain('.rotate(');
    expect(help).toContain('.scale(');
  });

  it('should return ops help', () => {
    const help = getHelp('ops');
    expect(help).toContain('.roundCorners(');
    expect(help).toContain('.offset(');
    expect(help).toContain('.trim(');
    expect(help).toContain('.dash(');
  });

  it('should return boolean help', () => {
    const help = getHelp('boolean');
    expect(help).toContain('union(');
    expect(help).toContain('subtract(');
    expect(help).toContain('intersect(');
    expect(help).toContain('clip(');
    expect(help).toContain('group(');
  });

  it('should return deformation help', () => {
    const help = getHelp('deformation');
    expect(help).toContain('.roughen(');
    expect(help).toContain('.zigzag(');
    expect(help).toContain('.warp(');
    expect(help).toContain('.twist(');
  });

  it('should return history help', () => {
    const help = getHelp('history');
    expect(help).toContain('undo(');
    expect(help).toContain('redo(');
    expect(help).toContain('mute(');
    expect(help).toContain('tree()');
    expect(help).toContain('nodes()');
  });

  it('should return files help', () => {
    const help = getHelp('files');
    expect(help).toContain('open(');
    expect(help).toContain('save(');
    expect(help).toContain('export(');
    expect(help).toContain('preview(');
    expect(help).toContain('.graph');
    expect(help).toContain('.svg');
    expect(help).toContain('.fig');
  });

  it('should return wordart help', () => {
    const help = getHelp('wordart');
    expect(help).toContain('arcText(');
    expect(help).toContain('wavyText(');
    expect(help).toContain('ribbon(');
    expect(help).toContain('badge(');
    expect(help).toContain('burst(');
    expect(help).toContain('spiralPath(');
    expect(help).toContain('bubble(');
    expect(help).toContain('input');
  });

  it('should return examples help', () => {
    const help = getHelp('examples');
    expect(help).toContain('canvas(');
    expect(help).toContain('group(');
    expect(help).toContain('export(');
  });

  it('should return all help', () => {
    const help = getHelp('all');
    expect(help).toContain('GENERATORS');
    expect(help).toContain('STYLE');
    expect(help).toContain('BOOLEAN');
    expect(help).toContain('HISTORY');
    expect(help).toContain('WORD ART');
    expect(help).toContain('EXAMPLES');
  });

  it('should handle unknown topic', () => {
    const help = getHelp('nonexistent');
    expect(help).toContain('Unknown topic');
  });

  it('should be case-insensitive', () => {
    expect(getHelp('Generators')).toContain('rect(');
    expect(getHelp('STYLE')).toContain('.fill(');
  });
});
