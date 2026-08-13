/**
 * Basic HTML components for Canvas Engine
 */

import type React from 'react';
import type { ComponentDefinition } from './canvas-engine';

/**
 * Div component
 */
export const DivComponent: ComponentDefinition = {
  type: 'div',
  label: 'Div',
  category: 'HTML',
  fields: {
    className: {
      type: 'text',
      label: 'Class Name',
      defaultValue: '',
    },
  },
  defaultProps: {},
  render: ({ props, children }) => <div {...props}>{children}</div>,
  canHaveChildren: true,
  hidden: true, // Не показываем в компонентах для вставки
};

/**
 * Button component
 */
export const ButtonHTMLComponent: ComponentDefinition = {
  type: 'button',
  label: 'Button (HTML)',
  category: 'HTML',
  fields: {
    children: {
      type: 'text',
      label: 'Text',
      defaultValue: 'Button',
    },
    className: {
      type: 'text',
      label: 'Class Name',
      defaultValue: '',
    },
  },
  defaultProps: {},
  render: ({ props, children }) => <button {...props}>{children || (props.children as React.ReactNode)}</button>,
  canHaveChildren: true,
  hidden: true,
};

/**
 * Span component
 */
export const SpanComponent: ComponentDefinition = {
  type: 'span',
  label: 'Span',
  category: 'HTML',
  fields: {
    children: {
      type: 'text',
      label: 'Text',
      defaultValue: '',
    },
    className: {
      type: 'text',
      label: 'Class Name',
      defaultValue: '',
    },
  },
  defaultProps: {},
  render: ({ props, children }) => <span {...props}>{children || (props.children as React.ReactNode)}</span>,
  canHaveChildren: true,
  hidden: true,
};

/**
 * SVG component
 */
export const SVGComponent: ComponentDefinition = {
  type: 'svg',
  label: 'SVG',
  category: 'HTML',
  fields: {},
  defaultProps: {},
  render: ({ props, children }) => (
    // biome-ignore lint/a11y/noSvgWithoutTitle: generic SVG container, user controls accessibility via props
    <svg {...props}>{children}</svg>
  ),
  canHaveChildren: true,
  hidden: true,
};

/**
 * Rect component
 */
export const RectComponent: ComponentDefinition = {
  type: 'rect',
  label: 'Rect',
  category: 'HTML',
  fields: {},
  defaultProps: {},
  render: ({ props }) => <rect {...props} />,
  canHaveChildren: false,
  hidden: true,
};

/**
 * Circle component
 */
export const CircleComponent: ComponentDefinition = {
  type: 'circle',
  label: 'Circle',
  category: 'HTML',
  fields: {},
  defaultProps: {},
  render: ({ props }) => <circle {...props} />,
  canHaveChildren: false,
  hidden: true,
};

/**
 * Polyline component
 */
export const PolylineComponent: ComponentDefinition = {
  type: 'polyline',
  label: 'Polyline',
  category: 'HTML',
  fields: {},
  defaultProps: {},
  render: ({ props }) => <polyline {...props} />,
  canHaveChildren: false,
  hidden: true,
};

/**
 * Input component
 */
export const InputHTMLComponent: ComponentDefinition = {
  type: 'input',
  label: 'Input (HTML)',
  category: 'HTML',
  fields: {
    type: {
      type: 'text',
      label: 'Type',
      defaultValue: 'text',
    },
    placeholder: {
      type: 'text',
      label: 'Placeholder',
      defaultValue: '',
    },
    className: {
      type: 'text',
      label: 'Class Name',
      defaultValue: '',
    },
  },
  defaultProps: {},
  render: ({ props }) => <input {...props} />,
  canHaveChildren: false,
  hidden: true,
};

/**
 * All HTML components
 */
export const htmlComponents = [
  DivComponent,
  ButtonHTMLComponent,
  SpanComponent,
  InputHTMLComponent,
  SVGComponent,
  RectComponent,
  CircleComponent,
  PolylineComponent,
];
