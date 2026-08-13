export const TID = {
  // Preview Panel
  preview: {
    iframe: 'hyper-preview-iframe',
    surface: 'hyper-preview-surface',
    addressBar: 'hyper-preview-address-bar',
    startServerButton: 'hyper-preview-start-server',
    unsupportedRoot: 'hyper-preview-unsupported',
    unsupportedFixButton: 'hyper-preview-unsupported-fix',
    unsupportedFrameworkRoot: 'hyper-preview-unsupported-framework',
    unsupportedFrameworkRow: (name: string) => `hyper-preview-unsupported-framework-row-${name}`,
    toolbarMode: (mode: string) => `hyper-preview-mode-${mode}`,
    contextMenu: 'hyper-preview-context-menu',
    contextMenuItem: (action: string) => `hyper-preview-context-${action}`,
    nonPreviewableRoot: 'hyper-preview-non-previewable',
    nonPreviewableRecommendation: (path: string) => `hyper-preview-non-previewable-rec-${path}`,
    componentErrorOverlay: 'hyper-preview-component-error',
    componentErrorCreateSample: 'hyper-preview-component-error-create-sample',
    componentErrorConfigureAI: 'hyper-preview-component-error-configure-ai',
    componentErrorAttentionProps: 'hyper-preview-component-error-attention-props',
    loadingOverlay: 'hyper-preview-loading-overlay',
    loadingTimeout: 'hyper-preview-loading-timeout',
    loadingTimeoutRetry: 'hyper-preview-loading-timeout-retry',
    loadingTimeoutOpenOutput: 'hyper-preview-loading-timeout-open-output',
    loadingError: 'hyper-preview-loading-error',
    loadingErrorRetry: 'hyper-preview-loading-error-retry',
    loadingErrorOpenOutput: 'hyper-preview-loading-error-open-output',
    loadingErrorMessage: 'hyper-preview-loading-error-message',
    // Component picker — centered empty-state list shown in the canvas when no component is
    // selected AND both side panels (Explorer + Inspector) are hidden, so a component can be
    // picked with no panel open. Clicking an item drives the normal stateHub selection pipeline.
    componentPicker: 'hyper-preview-component-picker',
    componentPickerItem: (name: string) => `hyper-preview-component-picker-item-${name}`,
  },

  // Inspector (Right Sidebar)
  inspector: {
    root: 'hyper-inspector-root',
    sectionHeader: (name: string) => `hyper-inspector-section-${name}`,
    // Layout
    layoutDisplaySelect: 'hyper-inspector-layout-display',
    layoutFlexDirection: 'hyper-inspector-layout-flex-direction',
    layoutJustify: 'hyper-inspector-layout-justify',
    layoutAlign: 'hyper-inspector-layout-align',
    layoutGap: 'hyper-inspector-layout-gap',
    layoutWidth: 'hyper-inspector-layout-width',
    layoutHeight: 'hyper-inspector-layout-height',
    layoutOverflow: 'hyper-inspector-layout-overflow',
    // Position
    positionTypeSelect: 'hyper-inspector-position-type',
    positionInput: (side: string) => `hyper-inspector-position-${side}`,
    zIndex: 'hyper-inspector-z-index',
    // Margin/Padding
    spacingInput: (type: string, side: string) => `hyper-inspector-${type}-${side}`,
    spacingLink: (type: string) => `hyper-inspector-${type}-link`,
    // Fill
    fillColorInput: 'hyper-inspector-fill-color',
    fillColorPicker: 'hyper-inspector-fill-picker',
    fillTextColor: 'hyper-inspector-fill-text-color',
    fillOpacity: 'hyper-inspector-fill-opacity',
    fillImageUrl: 'hyper-inspector-fill-image-url',
    fillAddButton: 'hyper-inspector-fill-add',
    fillRemoveButton: 'hyper-inspector-fill-remove',
    // Stroke
    strokeColor: 'hyper-inspector-stroke-color',
    strokeWidth: 'hyper-inspector-stroke-width',
    strokeStyle: 'hyper-inspector-stroke-style',
    // Effects
    shadowInput: (index: number, prop: string) => `hyper-inspector-shadow-${index}-${prop}`,
    shadowAdd: 'hyper-inspector-shadow-add',
    shadowRemove: (index: number) => `hyper-inspector-shadow-remove-${index}`,
    // Appearance
    opacitySlider: 'hyper-inspector-opacity-slider',
    opacityInput: 'hyper-inspector-opacity-input',
    rotateInput: 'hyper-inspector-rotate',
    // Typography
    fontFamily: 'hyper-inspector-font-family',
    fontSize: 'hyper-inspector-font-size',
    fontWeight: 'hyper-inspector-font-weight',
    lineHeight: 'hyper-inspector-line-height',
    letterSpacing: 'hyper-inspector-letter-spacing',
    // State selector
    stateSelect: 'hyper-inspector-state-select',
    // Component quick-list (fallback shown when Explorer is hidden + no component open)
    componentQuickList: 'hyper-inspector-component-quick-list',
    quickListItem: (name: string) => `hyper-inspector-quick-component-${name}`,
    // Header
    componentName: 'hyper-inspector-component-name',
    goToMasterComponent: 'hyper-inspector-go-to-master-component',
    breadcrumb: 'hyper-inspector-breadcrumb',
    // View controls
    viewToggle: (name: string) => `hyper-inspector-view-${name}`,
    // Generic numeric input (by CSS property)
    numericInput: (prop: string) => `hyper-inspector-numeric-${prop}`,
    // Color combobox
    colorCombobox: (context: string) => `hyper-inspector-color-${context}`,
    colorSwatch: (context: string) => `hyper-inspector-swatch-${context}`,
  },

  // Explorer (Left Sidebar)
  explorer: {
    root: 'hyper-explorer-root',
    searchInput: 'hyper-explorer-search',
    componentItem: (name: string) => `hyper-explorer-component-${name}`,
    componentGroup: (name: string) => `hyper-explorer-group-${name}`,
    treeItem: (id: string) => `hyper-explorer-tree-${id}`,
    treeExpand: (id: string) => `hyper-explorer-tree-expand-${id}`,
    pageItem: (name: string) => `hyper-explorer-page-${name}`,
    testItem: (name: string) => `hyper-explorer-test-${name}`,
    runTestsButton: 'hyper-explorer-run-tests',
    subProject: (name: string) => `hyper-explorer-subproject-${name}`,
    subProjectUnsupported: (name: string) => `hyper-explorer-subproject-unsupported-${name}`,
  },

  // AI Chat
  aiChat: {
    root: 'hyper-aichat-root',
    input: 'hyper-aichat-input',
    sendButton: 'hyper-aichat-send',
    abortButton: 'hyper-aichat-abort',
    message: (index: number) => `hyper-aichat-message-${index}`,
    toolCall: (index: number) => `hyper-aichat-tool-${index}`,
    toolResult: (index: number) => `hyper-aichat-tool-result-${index}`,
    newChatButton: 'hyper-aichat-new-chat',
    chatDropdownTrigger: 'hyper-aichat-dropdown-trigger',
    chatHistoryItem: (index: number) => `hyper-aichat-history-${index}`,
    configureKeyButton: 'hyper-aichat-configure-key',
    providerSelect: 'hyper-aichat-provider-select',
    askUserYes: 'hyper-aichat-ask-yes',
    askUserNo: 'hyper-aichat-ask-no',
  },

  // Logs Panel
  logs: {
    root: 'hyper-logs-root',
    clearButton: 'hyper-logs-clear',
    autoFixButton: 'hyper-logs-autofix',
    dismissButton: 'hyper-logs-dismiss',
    filterToggle: (source: string) => `hyper-logs-filter-${source}`,
    timeRangeSelect: 'hyper-logs-time-range',
    searchInput: 'hyper-logs-search',
    entry: (index: number) => `hyper-logs-entry-${index}`,
  },

  // Insert Panel
  insert: {
    root: 'hyper-insert-root',
    searchInput: 'hyper-insert-search',
    componentItem: (name: string) => `hyper-insert-component-${name}`,
    categoryAccordion: (name: string) => `hyper-insert-category-${name}`,
    expandButton: 'hyper-insert-expand',
  },

  // Dev Server
  devServer: {
    startButton: 'hyper-devserver-start',
    stopButton: 'hyper-devserver-stop',
    statusBadge: 'hyper-devserver-status',
  },

  // Status Bar
  statusBar: {
    extensionStatus: 'hyper-statusbar-status',
    mcpIcon: 'hyper-statusbar-mcp',
  },
} as const;
