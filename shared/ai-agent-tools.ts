/**
 * Shared AI Agent Tool Definitions
 *
 * Single source of truth for tool schemas used by both SaaS (server/services/ai-agent.ts)
 * and VSCode extension (bridges/AIBridge.ts).
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================
// File Tools
// ============================================

export const READ_FILE: ToolDefinition = {
  name: 'read_file',
  description: 'Read contents of a file from the repository. You can optionally specify line range.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from repository root',
      },
      startLine: {
        type: 'number',
        description: 'Optional starting line number (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Optional ending line number (1-indexed)',
      },
    },
    required: ['path'],
  },
};

export const EDIT_FILE: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing old content with new content. Use exact string matching.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from repository root',
      },
      oldContent: {
        type: 'string',
        description: 'Exact string to replace (must match exactly)',
      },
      newContent: {
        type: 'string',
        description: 'New string to replace with',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace all occurrences (default: false, replaces only first occurrence)',
      },
    },
    required: ['path', 'oldContent', 'newContent'],
  },
};

export const GREP_SEARCH: ToolDefinition = {
  name: 'grep_search',
  description: 'Search for text patterns in files using grep. Supports regex patterns.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (regex supported)',
      },
      path: {
        type: 'string',
        description: 'Optional relative path to search in (defaults to repository root)',
      },
      filePattern: {
        type: 'string',
        description: 'Optional file pattern to filter (e.g., "*.ts")',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
      },
    },
    required: ['pattern'],
  },
};

export const GLOB_SEARCH: ToolDefinition = {
  name: 'glob_search',
  description: 'Find files by pattern (e.g., "**/*.ts", "src/**/*.tsx").',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files',
      },
      path: {
        type: 'string',
        description: 'Optional relative path to search in (defaults to repository root)',
      },
    },
    required: ['pattern'],
  },
};

export const LIST_DIRECTORY: ToolDefinition = {
  name: 'list_directory',
  description: 'List directory contents with file details (type, size, modified date).',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative directory path from repository root',
      },
      showHidden: {
        type: 'boolean',
        description: 'Show hidden files (starting with dot)',
      },
    },
    required: ['path'],
  },
};

export const TREE: ToolDefinition = {
  name: 'tree',
  description: 'Show directory tree structure. Useful for understanding project layout.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative directory path (defaults to root)',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum depth to traverse (default: 3)',
      },
      includeFiles: {
        type: 'boolean',
        description: 'Include files in output (default: true)',
      },
    },
  },
};

export const WRITE_FILE: ToolDefinition = {
  name: 'write_file',
  description: 'Create a new file or overwrite existing file with content.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path for the new file',
      },
      content: {
        type: 'string',
        description: 'File content to write',
      },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist (default: true)',
      },
    },
    required: ['path', 'content'],
  },
};

export const MOVE_FILE: ToolDefinition = {
  name: 'move_file',
  description: 'Move or rename a file or directory.',
  input_schema: {
    type: 'object',
    properties: {
      sourcePath: {
        type: 'string',
        description: 'Current relative path of file/directory',
      },
      destPath: {
        type: 'string',
        description: 'New relative path for file/directory',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite destination if exists (default: false)',
      },
    },
    required: ['sourcePath', 'destPath'],
  },
};

export const DELETE_FILE: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or empty directory. Use with caution.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to delete',
      },
      recursive: {
        type: 'boolean',
        description: 'Delete directory recursively (default: false, only empty dirs)',
      },
    },
    required: ['path'],
  },
};

export const FILE_TOOLS: ToolDefinition[] = [
  READ_FILE,
  EDIT_FILE,
  WRITE_FILE,
  GREP_SEARCH,
  GLOB_SEARCH,
  LIST_DIRECTORY,
  TREE,
  MOVE_FILE,
  DELETE_FILE,
];

// ============================================
// Shell Tools
// ============================================

export const BASH_EXEC: ToolDefinition = {
  name: 'bash_exec',
  description: 'Execute a bash command in the repository directory. Use with caution.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
};

export const GIT_COMMAND: ToolDefinition = {
  name: 'git_command',
  description: 'Execute git commands (status, diff, log, show, blame).',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'show', 'blame'],
        description: 'Git command to execute',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional arguments for the git command',
      },
    },
    required: ['command'],
  },
};

export const SHELL_TOOLS: ToolDefinition[] = [BASH_EXEC, GIT_COMMAND];

// ============================================
// Interactive Tools
// ============================================

export const ASK_USER: ToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question and wait for their response. Use when you need more information to proceed.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional predefined choices for the user to select from',
      },
    },
    required: ['question'],
  },
};

export const INTERACTIVE_TOOLS: ToolDefinition[] = [ASK_USER];

// ============================================
// Browser Tools (Playwright MCP)
// ============================================

export const BROWSER_NAVIGATE: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate browser to URL. Use "preview" as url to open current component preview.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to. Use "preview" to open project preview with current component.',
      },
    },
    required: ['url'],
  },
};

export const BROWSER_TAKE_SCREENSHOT: ToolDefinition = {
  name: 'browser_take_screenshot',
  description: 'Take a screenshot of the current page or element.',
  input_schema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'File name to save the screenshot (optional)',
      },
      element: {
        type: 'string',
        description: 'Human-readable element description (optional)',
      },
      ref: {
        type: 'string',
        description: 'Element reference from browser_snapshot (optional)',
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture full scrollable page (default: false)',
      },
    },
  },
};

export const BROWSER_CLICK: ToolDefinition = {
  name: 'browser_click',
  description: 'Click an element on the page. Use browser_snapshot first to find element refs.',
  input_schema: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Human-readable element description',
      },
      ref: {
        type: 'string',
        description: 'Exact element reference from browser_snapshot',
      },
    },
    required: ['element', 'ref'],
  },
};

export const BROWSER_TYPE: ToolDefinition = {
  name: 'browser_type',
  description: 'Type text into an input field.',
  input_schema: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Human-readable element description',
      },
      ref: {
        type: 'string',
        description: 'Exact element reference from browser_snapshot',
      },
      text: {
        type: 'string',
        description: 'Text to type',
      },
    },
    required: ['element', 'ref', 'text'],
  },
};

export const BROWSER_SNAPSHOT: ToolDefinition = {
  name: 'browser_snapshot',
  description:
    'Get accessibility tree of the page (DOM structure for interaction). Call this before browser_click or browser_type.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export const BROWSER_HOVER: ToolDefinition = {
  name: 'browser_hover',
  description: 'Hover over an element.',
  input_schema: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Human-readable element description',
      },
      ref: {
        type: 'string',
        description: 'Exact element reference from browser_snapshot',
      },
    },
    required: ['element', 'ref'],
  },
};

export const BROWSER_TOOLS: ToolDefinition[] = [
  BROWSER_NAVIGATE,
  BROWSER_TAKE_SCREENSHOT,
  BROWSER_CLICK,
  BROWSER_TYPE,
  BROWSER_SNAPSHOT,
  BROWSER_HOVER,
];

// ============================================
// Canvas Tools (UX Flow)
// ============================================

export const CANVAS_CREATE_INSTANCE: ToolDefinition = {
  name: 'canvas_create_instance',
  description:
    'Create a new component instance on the canvas with specific props for UX flow. Use this to show a component in different states.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file (e.g., "src/components/Button.tsx")',
      },
      instanceId: {
        type: 'string',
        description: 'Unique ID for this instance (e.g., "loading_state", "error_state")',
      },
      x: { type: 'number', description: 'X position on canvas' },
      y: { type: 'number', description: 'Y position on canvas' },
      props: {
        type: 'object',
        description: 'Props to pass to component (JSON-serializable values only)',
      },
      label: {
        type: 'string',
        description: 'Human-readable label for this instance',
      },
      width: {
        type: 'number',
        description: 'Width of instance in pixels (optional, auto from component if not specified)',
      },
      height: {
        type: 'number',
        description: 'Height of instance in pixels (optional, auto from component if not specified)',
      },
    },
    required: ['componentPath', 'instanceId', 'x', 'y', 'props'],
  },
};

export const CANVAS_UPDATE_INSTANCE: ToolDefinition = {
  name: 'canvas_update_instance',
  description: 'Update an existing instance props or position.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      instanceId: {
        type: 'string',
        description: 'ID of instance to update',
      },
      updates: {
        type: 'object',
        description: 'Fields to update: x, y, width, height, props, label',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          props: { type: 'object' },
          label: { type: 'string' },
        },
      },
    },
    required: ['componentPath', 'instanceId', 'updates'],
  },
};

export const CANVAS_DELETE_INSTANCE: ToolDefinition = {
  name: 'canvas_delete_instance',
  description: 'Delete an instance from the canvas.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      instanceId: {
        type: 'string',
        description: 'ID of instance to delete',
      },
    },
    required: ['componentPath', 'instanceId'],
  },
};

export const CANVAS_LIST_INSTANCES: ToolDefinition = {
  name: 'canvas_list_instances',
  description: 'List all instances for a component on the canvas.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
    },
    required: ['componentPath'],
  },
};

export const CANVAS_CONNECT_INSTANCES: ToolDefinition = {
  name: 'canvas_connect_instances',
  description: 'Create an arrow/connection between two instances to show flow.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      fromInstanceId: {
        type: 'string',
        description: 'ID of source instance',
      },
      toInstanceId: {
        type: 'string',
        description: 'ID of target instance',
      },
      label: {
        type: 'string',
        description: 'Optional label for the connection (e.g., "onClick", "onSubmit")',
      },
    },
    required: ['componentPath', 'fromInstanceId', 'toInstanceId'],
  },
};

export const CANVAS_ADD_ANNOTATION: ToolDefinition = {
  name: 'canvas_add_annotation',
  description: 'Add a text annotation to the canvas.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      x: { type: 'number', description: 'X position on canvas' },
      y: { type: 'number', description: 'Y position on canvas' },
      text: { type: 'string', description: 'Annotation text' },
    },
    required: ['componentPath', 'x', 'y', 'text'],
  },
};

export const CANVAS_MODIFY_MAP_ITEMS: ToolDefinition = {
  name: 'canvas_modify_map_items',
  description:
    'Add or remove items in an array prop that is used in .map() iteration. Use to change how many items appear in a list/grid.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      instanceId: {
        type: 'string',
        description: 'ID of instance to modify',
      },
      arrayPropName: {
        type: 'string',
        description: 'Name of the array prop (e.g., "items", "screenshots", "users")',
      },
      targetCount: {
        type: 'number',
        description: 'Desired number of items in the array',
      },
    },
    required: ['componentPath', 'instanceId', 'arrayPropName', 'targetCount'],
  },
};

export const CANVAS_MODIFY_COND_ITEM: ToolDefinition = {
  name: 'canvas_modify_cond_item',
  description:
    'Toggle a boolean prop that controls conditional rendering (e.g., isLoading, isError, isOpen). Use to show/hide conditional elements.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      instanceId: {
        type: 'string',
        description: 'ID of instance to modify',
      },
      booleanPropName: {
        type: 'string',
        description: 'Name of the boolean prop (e.g., "isLoading", "isError", "isOpen", "showModal")',
      },
      value: {
        type: 'boolean',
        description: 'Desired value for the boolean prop',
      },
    },
    required: ['componentPath', 'instanceId', 'booleanPropName', 'value'],
  },
};

export const CANVAS_AUTO_GENERATE_VARIANTS: ToolDefinition = {
  name: 'canvas_auto_generate_variants',
  description:
    'Auto-generate test variants for a component in canvas.json. Analyzes component props and CVA variants to create instances for different states (default, disabled, loading, error, etc.).',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file (e.g., "src/components/Button.tsx")',
      },
      strategy: {
        type: 'string',
        enum: ['minimal', 'comprehensive'],
        description:
          'Generation strategy: minimal (default + key states) or comprehensive (all combinations). Default: minimal',
      },
      layout: {
        type: 'string',
        enum: ['grid', 'horizontal', 'vertical'],
        description: 'How to arrange instances on canvas. Default: grid',
      },
      spacing: {
        type: 'number',
        description: 'Spacing between instances in pixels. Default: 300',
      },
    },
    required: ['componentPath'],
  },
};

export const ANALYZE_COMPONENT_PROPS: ToolDefinition = {
  name: 'analyze_component_props',
  description: 'Analyze a component to understand its props interface and possible states.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
    },
    required: ['componentPath'],
  },
};

export const SUGGEST_FLOW_STATES: ToolDefinition = {
  name: 'suggest_flow_states',
  description: 'Analyze a component and suggest different states/instances for UX flow visualization.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to component file',
      },
      context: {
        type: 'string',
        description: 'Optional context about what flow to visualize (e.g., "form submission flow", "error handling")',
      },
    },
    required: ['componentPath'],
  },
};

export const CANVAS_TOOLS: ToolDefinition[] = [
  CANVAS_CREATE_INSTANCE,
  CANVAS_UPDATE_INSTANCE,
  CANVAS_DELETE_INSTANCE,
  CANVAS_LIST_INSTANCES,
  CANVAS_CONNECT_INSTANCES,
  CANVAS_ADD_ANNOTATION,
  CANVAS_MODIFY_MAP_ITEMS,
  CANVAS_MODIFY_COND_ITEM,
  CANVAS_AUTO_GENERATE_VARIANTS,
  ANALYZE_COMPONENT_PROPS,
  SUGGEST_FLOW_STATES,
];

// ============================================
// Test Tools
// ============================================

export const GENERATE_TESTS: ToolDefinition = {
  name: 'generate_tests',
  description:
    'Generate tests for a React component. Creates unit tests (bun:test), E2E tests (Playwright), visual snapshots, and component variants with different props.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to the component file (e.g., "client/components/ui/button.tsx")',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['unit', 'e2e', 'variants', 'demo'],
        },
        description: 'Types of tests to generate. Defaults to all types.',
      },
      force: {
        type: 'boolean',
        description: 'Overwrite existing test files if they exist',
      },
    },
    required: ['componentPath'],
  },
};

export const ANALYZE_COMPONENT_TESTS: ToolDefinition = {
  name: 'analyze_component_tests',
  description:
    'Analyze a component to find interactive elements and suggest test coverage. Returns information about buttons, inputs, variants, and other testable elements.',
  input_schema: {
    type: 'object',
    properties: {
      componentPath: {
        type: 'string',
        description: 'Relative path to the component file',
      },
    },
    required: ['componentPath'],
  },
};

export const RUN_TESTS: ToolDefinition = {
  name: 'run_tests',
  description:
    'Run tests for specified test files in the project Docker container. Returns test results including passed/failed counts, output logs, and any configuration errors.',
  input_schema: {
    type: 'object',
    properties: {
      testPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of test file paths relative to project root (e.g., ["src/examples/Button.unit.test.tsx"])',
      },
      installDeps: {
        type: 'boolean',
        description: 'If true, automatically install missing packages and retry tests. Default: false',
      },
    },
    required: ['testPaths'],
  },
};

export const TEST_TOOLS: ToolDefinition[] = [GENERATE_TESTS, ANALYZE_COMPONENT_TESTS, RUN_TESTS];

// ============================================
// Server Management Tools
// ============================================

export const RESTART_DEV_SERVER: ToolDefinition = {
  name: 'restart_dev_server',
  description:
    'Restart the development server for the current project. Use this tool after modifying database models, configuration files, environment variables, or when the server crashes or becomes unresponsive. Returns server logs after restart.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Optional reason for restart (for logging purposes)',
      },
    },
  },
};

export const GET_CONTAINER_LOGS: ToolDefinition = {
  name: 'get_container_logs',
  description:
    'Get recent container logs from the project dev server. Use this to debug startup issues, runtime errors, build failures, or investigate why the application is not working.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'number',
        description: 'Number of log lines to retrieve. Default: 100, max: 500.',
      },
      includePrevious: {
        type: 'boolean',
        description:
          'Include logs from before the last container restart (useful for crash debugging). Only works in Kubernetes mode.',
      },
      includeEvents: {
        type: 'boolean',
        description: 'Include Kubernetes pod events (scheduling, image pull, restarts). Only works in Kubernetes mode.',
      },
    },
  },
};

export const SERVER_TOOLS: ToolDefinition[] = [RESTART_DEV_SERVER, GET_CONTAINER_LOGS];

// ============================================
// Web Tools
// ============================================

export const BRAVE_WEB_SEARCH: ToolDefinition = {
  name: 'brave_web_search',
  description:
    'Search the web using Brave Search API. Returns titles, URLs, and descriptions of search results. Use this to find information, documentation, examples, or solutions online.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (be specific for better results)',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-20, default: 10)',
      },
    },
    required: ['query'],
  },
};

export const URL_FETCH: ToolDefinition = {
  name: 'url_fetch',
  description:
    'Fetch content from a URL and convert HTML to readable Markdown. Use this to read documentation pages, articles, or any web content. Returns cleaned text without HTML tags.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full URL to fetch (must start with http:// or https://)',
      },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to extract specific content (e.g., "article", "main", ".content")',
      },
    },
    required: ['url'],
  },
};

export const WEB_TOOLS: ToolDefinition[] = [BRAVE_WEB_SEARCH, URL_FETCH];

// ============================================
// Extension-Only Tools
// ============================================

export const CHECK_BUILD_STATUS: ToolDefinition = {
  name: 'check_build_status',
  description:
    'Wait for build to settle and check if the dev server has build errors or runtime errors. Use after editing files to verify the fix worked.',
  input_schema: {
    type: 'object',
    properties: {
      waitSeconds: {
        type: 'number',
        description: 'Seconds to wait before checking (1-10, default: 3). Gives time for HMR to rebuild.',
      },
    },
  },
};

// ============================================
// Aggregated Exports
// ============================================

/** All tools available in SaaS mode */
export const ALL_TOOLS: ToolDefinition[] = [
  ...FILE_TOOLS,
  ...SHELL_TOOLS,
  ...INTERACTIVE_TOOLS,
  ...BROWSER_TOOLS,
  ...CANVAS_TOOLS,
  ...TEST_TOOLS,
  ...SERVER_TOOLS,
  ...WEB_TOOLS,
];
