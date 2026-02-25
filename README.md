# HyperIDE

HyperIDE is a visual React component builder and editor that enables real-time component manipulation through an intuitive drag-and-drop interface. It provides a powerful canvas-based editing experience with live preview, component introspection, and seamless integration with existing React projects.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Core Components](#core-components)
- [Architectural Decisions](#architectural-decisions)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Development](#development)
- [Contributing](#contributing)

## Features

### Visual Component Editing

- **Live Canvas Editor**: Real-time visual editing of React components with immediate feedback
- **Drag & Drop Interface**: Intuitive component placement and hierarchy management
- **Component Tree View**: Hierarchical visualization of component structure with AST integration
- **Property Editor**: Dynamic property modification with TypeScript support and validation

### Project Management

- **Multi-Project Support**: Manage multiple React projects simultaneously
- **Git Integration**: Clone and work with Git repositories directly
- **Framework Detection**: Automatic detection and configuration for Vite, Next.js, and other frameworks
- **Docker Isolation**: Optional Docker containerization for secure project execution

### Component System

- **Component Registry**: Dynamic registration and management of React components
- **HTML Components**: Built-in HTML element support with full attribute control
- **Custom Components**: Import and use components from external projects
- **Props Generation**: AI-powered default props generation for components

### Advanced Features

- **Iframe Isolation**: Secure component rendering in isolated iframe contexts
- **AST Manipulation**: Direct Abstract Syntax Tree manipulation for code generation
- **Tailwind CSS Support**: Built-in Tailwind utilities parsing and application
- **Undo/Redo System**: Full history management for all canvas operations
- **AI Integration**: OpenAI/Claude/GLM integration for component generation

## Architecture Overview

HyperIDE follows a client-server architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React)                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Canvas Engine│  │ Component    │  │ UI Components│       │
│  │              │  │ Registry     │  │ (shadcn/ui)  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Iframe Canvas│  │ State Store  │  │ Context      │       │
│  │              │  │ (Zustand)    │  │ Providers    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                        Server (Bun + Hono)                  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ API Routes   │  │ Project      │  │ AST Parser   │       │
│  │              │  │ Manager      │  │ (Babel)      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Git Service  │  │ Docker       │  │ AI Service   │       │
│  │              │  │ Manager      │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              ↕ File System / Database
┌─────────────────────────────────────────────────────────────┐
│                        Storage Layer                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ PostgreSQL   │  │ Project Files│  │ Cloned Repos │       │
│  │              │  │              │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend

- **React 18.3**: Core UI framework with hooks and concurrent features
- **TypeScript 5.9**: Type safety and enhanced developer experience
- **Zustand 5.0**: Lightweight state management
- **React Router 6.30**: Client-side routing
- **Tanstack Query 5.84**: Server state management
- **Tailwind CSS 3.4**: Utility-first CSS framework
- **shadcn/ui**: Accessible and customizable component library

### Backend

- **Bun**: JavaScript runtime and package manager
- **Hono 4.x**: Lightweight web framework
- **Babel Parser 7.26**: AST parsing and manipulation
- **Recast 0.23**: JavaScript/TypeScript code transformation
- **PostgreSQL + Drizzle ORM**: Type-safe database with migrations
- **Anthropic SDK**: AI integration for component generation

### Development Tools

- **Bun Test**: Built-in test runner
- **Biome 2.x**: Fast linter and formatter
- **Docker**: Container support for project isolation
- **TypeScript**: Type checking across the stack

## Project Structure

```
hyper-canvas-draft/
├── client/                     # Frontend React application
│   ├── components/            # React components
│   │   ├── ui/               # shadcn/ui components
│   │   ├── icons/            # Custom icon components
│   │   ├── IframeCanvas.tsx  # Iframe rendering component
│   │   ├── LeftSidebar.tsx   # Component tree and pages
│   │   ├── RightSidebar.tsx  # Properties panel
│   │   ├── Toolbar.tsx       # Main toolbar
│   │   └── ...
│   ├── lib/                   # Core libraries
│   │   ├── canvas-engine/    # Canvas manipulation engine
│   │   │   ├── core/         # Core engine classes
│   │   │   ├── operations/   # Canvas operations
│   │   │   ├── react/        # React integration
│   │   │   └── utils/        # Utilities
│   │   ├── htmlComponents.tsx # HTML element definitions
│   │   └── utils.ts          # Utility functions
│   ├── contexts/              # React contexts
│   ├── hooks/                 # Custom React hooks
│   ├── pages/                 # Page components
│   └── App.tsx               # Main application entry
├── server/                    # Backend Hono server
│   ├── routes/               # API route handlers
│   │   ├── projects.ts       # Project management
│   │   ├── parseComponent.ts # Component parsing
│   │   ├── docker.ts         # Docker integration
│   │   └── ...
│   ├── services/             # Business logic services
│   │   ├── project-analyzer.ts
│   │   ├── git-clone.ts
│   │   ├── docker-manager.ts
│   │   └── ai-code-generator.ts
│   ├── database/             # Database layer
│   │   └── schema/           # Drizzle ORM schema
│   └── utils/                # Server utilities
├── shared/                    # Shared types and constants
├── cloned-projects/          # Git cloned repositories
└── public/                   # Static assets
```

## Core Components

### Canvas Engine

The Canvas Engine (`client/lib/canvas-engine/`) is the heart of the visual editing system:

```typescript
class CanvasEngine {
  // Component registration and management
  registerComponent(definition: ComponentDefinition)
  unregisterComponent(type: string)

  // Instance manipulation
  loadInstances(componentType: string, props: any, parentId: string | null)
  updateInstance(id: string, updates: Partial<CanvasNode>)
  deleteInstance(id: string)

  // Tree operations
  moveNode(nodeId: string, newParentId: string, index: number)
  duplicateNode(nodeId: string)

  // History management
  undo()
  redo()

  // State persistence
  getSnapshot(): CanvasSnapshot
  loadSnapshot(snapshot: CanvasSnapshot)
}
```

**Key Design Decisions:**

- **Event-driven architecture**: All state changes emit events for UI updates
- **Immutable operations**: Every change creates a new state snapshot
- **Batch mode**: Multiple operations can be grouped for single UI update
- **Plugin system**: Operations are modular and extensible

### Component Registry

Manages available components for the canvas:

```typescript
interface ComponentDefinition {
  type: string;              // Unique component identifier
  category: ComponentCategory; // Grouping for UI
  label: string;             // Display name
  props: PropDefinition[];   // Property definitions
  defaultProps?: any;        // Default property values
  render: ComponentRender;   // Render function
  icon?: string;            // Optional icon
  acceptsChildren?: boolean; // Container component
}
```

### Iframe Canvas

Provides isolated rendering environment for user components:

```typescript
// Key features:
- Same-origin proxy for direct DOM access
- Event delegation for selection/hover
- Unique ID injection for element tracking
- Hot reload support
- Error boundary isolation
```

### AST Manipulation

Server-side AST parsing for component introspection:

```typescript
// Parse JSX/TSX components
parseComponent(filePath: string): ComponentAST

// Inject tracking IDs
injectUniqueIds(filePath: string, idMap: Record<string, string>)

// Update styles
updateComponentStyles(elementId: string, styles: TailwindClasses)
```

## Architectural Decisions

### 1. Iframe-Based Component Rendering

**Problem**: Need to render user components without polluting the main application context.

**Solution**: Use iframes with same-origin proxy for isolated rendering while maintaining DOM access.

**Benefits**:

- Complete style isolation
- Independent React instances
- Security boundary for untrusted code
- Hot module replacement support

**Trade-offs**:

- Communication overhead between frames
- Complex event handling
- Performance considerations for large trees

### 2. AST-Based Component Analysis

**Problem**: Need to understand component structure without executing code.

**Solution**: Parse components using Babel AST and extract structure statically.

**Benefits**:

- Safe analysis of untrusted code
- Accurate component tree extraction
- Support for TypeScript and JSX
- Enables code generation

**Trade-offs**:

- Limited to static analysis
- Complex parsing logic
- Requires source map handling

### 3. Event-Driven State Management

**Problem**: Multiple UI components need to react to canvas changes.

**Solution**: Event emitter pattern with centralized state management.

**Benefits**:

- Decoupled components
- Predictable state updates
- Easy testing and debugging
- Undo/redo support

**Trade-offs**:

- Event management complexity
- Potential memory leaks
- Debugging indirect updates

### 4. PostgreSQL with Drizzle ORM

**Problem**: Need persistent project configuration with type safety and migrations.

**Solution**: PostgreSQL database with Drizzle ORM for type-safe queries and schema management.

**Benefits**:

- Type-safe database queries
- Automatic migrations with Drizzle Kit
- Full SQL power when needed
- Scalable for production workloads
- Better tooling and debugging

**Trade-offs**:

- Requires PostgreSQL instance
- More complex local setup
- External dependency

### 5. Container Isolation (Required)

**Problem**: Running untrusted project code safely with different dependency versions.

**Solution**: Container-based isolation for all user project execution. Docker locally, containerd in production (Kubernetes).

**Benefits**:

- Complete process isolation
- Resource limits
- Network isolation
- Consistent environment per project
- Different dependency versions don't conflict

**Trade-offs**:

- Container runtime dependency
- Container management overhead
- Startup latency for cold containers

### 6. Tailwind CSS Integration

**Problem**: Need flexible styling system for generated components.

**Solution**: Parse and apply Tailwind classes dynamically.

**Benefits**:

- Utility-first approach
- Consistent design system
- Small bundle size
- IDE support

**Trade-offs**:

- Class name verbosity
- Learning curve
- Build-time processing

## API Documentation

### Project Management

#### `GET /api/projects`

List all projects.

**Response:**

```json
[{
  "id": "uuid",
  "name": "Project Name",
  "path": "/absolute/path",
  "framework": "vite",
  "status": "running",
  "port": 5173
}]
```

#### `POST /api/projects`

Create a new project.

**Request:**

```json
{
  "name": "Project Name",
  "path": "/path/to/project",
  "framework": "vite",
  "devCommand": "npm run dev"
}
```

#### `POST /api/projects/clone`

Clone a Git repository as a project.

**Request:**

```json
{
  "repoUrl": "https://github.com/user/repo.git",
  "name": "Project Name"
}
```

### Component Operations

#### `GET /api/parse-component`

Parse the active component's AST structure.

**Response:**

```json
{
  "success": true,
  "componentName": "Button",
  "structure": [/* AST nodes */],
  "filePath": "/path/to/component.tsx"
}
```

#### `POST /api/inject-unique-ids`

Inject unique IDs into component elements.

**Request:**

```json
{
  "filePath": "/path/to/component.tsx",
  "idMap": {
    "0": "element-id-1",
    "1": "element-id-2"
  }
}
```

#### `POST /api/update-styles`

Update element styles with Tailwind classes.

**Request:**

```json
{
  "elementId": "element-id",
  "styles": {
    "className": "flex items-center p-4"
  }
}
```

### AI Integration

#### `POST /api/generate-preview`

Generate component code using AI.

**Request:**

```json
{
  "prompt": "Create a button component",
  "framework": "react"
}
```

#### `GET /api/ai-config`

Get AI configuration.

#### `PUT /api/ai-config`

Update AI configuration.

**Request:**

```json
{
  "provider": "claude",
  "apiKey": "sk-...",
  "model": "claude-3-sonnet"
}
```

## Database Schema

Database schema is managed by Drizzle ORM with PostgreSQL. Schema files are located in `server/database/schema/`.

### Core Tables

- **workspaces** - Multi-tenant workspace support
- **users** - User authentication (session tokens, email verification)
- **projects** - Project configuration (workspace-scoped)
- **ai_config** - AI provider settings per workspace
- **ai_agent_chats** / **ai_agent_messages** - AI conversation history
- **fix_sessions** / **fix_attempts** - Auto-fix feature tracking
- **comments** - Code review comments

### Schema Management

```bash
# Generate migrations
DATABASE_URL="..." bunx drizzle-kit generate

# Push schema changes
DATABASE_URL="..." bunx drizzle-kit push

# Open Drizzle Studio
DATABASE_URL="..." bunx drizzle-kit studio
```

See `server/database/schema/` for complete type-safe schema definitions.

## Development

### Prerequisites

- Bun 1.2+
- Docker (required for running user projects)
- Git

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/hyper-canvas.git
cd hyper-canvas

# Install dependencies
bun install

# Create environment file
cp .env.example .env

# Start PostgreSQL and other services
docker compose up -d

# Start development server
bun dev
```

### Development Commands

```bash
# Start development server
bun dev

# Build for production
bun run build

# Run tests
bun test

# Type checking
bun run typecheck

# Format code
bun run format.fix

# Start production server
bun start
```

### Deployment

The project uses GitOps with ArgoCD. Every push to `main` triggers automatic deployment:

1. **Build** — Docker image built and pushed to `ghcr.io/hyperide/hypercanvas:<sha>` + `latest`
2. **Sync** — ArgoCD triggered to pull new image and deploy

#### Manual Deployment

```bash
# Trigger deployment manually
gh workflow run deploy.yml
```

#### Rollback

Rollback via ArgoCD history:

```bash
# List deployment history
argocd app history hypercanvas

# Rollback to previous version
argocd app rollback hypercanvas <HISTORY_ID>
```

Or via ArgoCD UI: **[argocd.hyperi.de](https://argocd.hyperi.de) → hypercanvas → History and rollback**

#### Image Retention

Only the last 10 image versions are kept. Older versions are automatically deleted after each deployment.

#### Monitoring

```bash
# Check deployment status
kubectl get pods -n hypercanvas

# View ArgoCD sync status
argocd app get hypercanvas

# Check application health
curl -s https://hyperi.de/api/health
```

### Project Configuration

The system automatically detects and configures projects based on their structure:

1. **Vite Projects**: Detected by `vite.config.ts/js`
2. **Next.js Projects**: Detected by `next.config.js`
3. **Create React App**: Detected by `react-scripts` in package.json

### Environment Variables

```bash
# API Keys (optional)
ANTHROPIC_API_KEY=your_api_key

# Server Configuration
PORT=8080
NODE_ENV=development

# Database Path (optional)
DB_PATH=./data/hyper-canvas.db
```

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Commit using conventional commits (`feat: add amazing feature`)
6. Push to your fork
7. Open a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow existing patterns and conventions
- Use Biome for linting and formatting
- Write tests for new features
- Document complex logic with comments

### Architecture Guidelines

- Keep components small and focused
- Use composition over inheritance
- Prefer functional components with hooks
- Maintain clear separation between client and server
- Write pure functions where possible
- Handle errors gracefully

### Testing Strategy

- Unit tests for utilities and services
- Integration tests for API endpoints
- Component tests for UI elements
- E2E tests for critical user flows

## License

Elastic License 2.0 (ELv2) - see LICENSE file for details

## Acknowledgments

- [shadcn/ui](https://ui.shadcn.com/) for the component library
- [Babel](https://babeljs.io/) for AST parsing
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Hono](https://hono.dev/) for backend framework
- [Drizzle ORM](https://orm.drizzle.team/) for database
