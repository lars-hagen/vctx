# vctx

Extract VS Code context for AI - open files, selections, and pinned tabs. Works with any VS Code-based IDE (VS Code, Cursor, etc.)

[vctx.io](https://vctx.io) | [npm](https://www.npmjs.com/package/vctx)

## Features

- 🔍 **Open Files**: Show actually open editor tabs (not recently accessed)
- 📌 **Pinned Files**: Detect sticky/pinned tabs
- ✂️ **Text Selections**: All selections across editor groups/splits  
- 🏗️ **Workspace Detection**: Automatic workspace mapping
- 🤖 **LLM-Friendly Output**: Structured output for Claude/AI consumption

## Installation

```bash
npm install -g vctx
```

Or use directly with npx:
```bash
npx vctx
```

## Usage

### Basic Usage
```bash
vctx  # Full context with smart defaults
```

**Output:**
```
=== VS CODE RAW CONTEXT ===
WORKSPACE: /Users/lars/repos/project
WORKSPACE_ID: 4a34da70d83079feef53923cac719c49

OPEN_FILES:
  1. /Users/lars/repos/project/src/main.js [PINNED]
  2. /Users/lars/repos/project/README.md [SELECTED:L15:C1-L25:C50]
  3. /Users/lars/repos/project/package.json

PINNED_FILES:
  1. /Users/lars/repos/project/src/main.js [PINNED]

SELECTIONS:
  1. /Users/lars/repos/project/README.md
     1. L15:C1-L25:C50
  2. /Users/lars/repos/project/src/utils.js
     1. L100:C10-15
     2. L200:C1-L210:C30

TOTAL_OPEN: 3
TOTAL_PINNED: 1
TOTAL_SELECTED: 2
=== END RAW CONTEXT ===
```

### Quick Commands
```bash
vctx -o   # Just open files
vctx -p   # Just pinned files  
vctx -s   # Just selections
vctx -w   # Just workspace info
```

### Advanced Options
```bash
vctx -j              # JSON output for scripts
vctx -c              # Include file content (default: on)
vctx -r              # Raw format with all sections
vctx --no-refresh    # Skip automatic state refresh
vctx --help          # Show all options
```

### Content Extraction
By default, vctx shows the actual selected text from files:

**Output includes actual selected code in IDE-style format:**
```
The user selected the following lines from /path/to/file.js:
const handleSubmit = async (data) => {
  setLoading(true);
  await api.post('/submit', data);
};
```

### Selection Formatting

**Default IDE-style format** (natural for LLM consumption):
```bash
vctx  # Shows content by default
```

**IDE-style output:**
```
The user selected the following lines from /path/to/file.js:
const handleSubmit = async (data) => {
  setLoading(true);
  await api.post('/submit', data);
};
```

**Legacy technical format** (use `--legacy-format` flag):
```bash
vctx --legacy-format  # Use legacy technical format
```

**Legacy output:**
```
SELECTIONS:
  1. /path/to/file.js
     1. L25:C10-45
        ```javascript
        const handleSubmit = async (data) => {
          setLoading(true);
          await api.post('/submit', data);
        };
        ```
```

The default IDE-style format matches how Claude sees selections in the IDE integration, making it perfect for LLM debugging workflows.

**Perfect for Claude debugging** - see exactly what code you have selected!

### Smart Mode (NEW!)
By default, the `raw` command uses **smart mode** to reduce redundant information:
- Pinned files are shown in OPEN_EDITORS with [PINNED] tag
- No separate PINNED_EDITORS section (avoiding duplication)
- Only shows summary counts that have values

To disable smart mode and see all sections:
```bash
vctx -r  # Raw mode shows all sections
```

## For Claude Users

This tool provides comprehensive VS Code context to help Claude understand:
- What files you're currently working on
- Which files are pinned (important/persistent)
- What text you have selected (areas of focus)
- Your workspace structure

**Recommended usage with Claude:**
```bash
vctx  # That's it!
```

Copy the output and paste it into Claude for enhanced debugging context.

## Technical Details

**Data Sources:**
- VS Code state: `~/Library/Application Support/Code/User/workspaceStorage/*/state.vscdb`
- Workspace mapping: `workspace.json` files
- Editor state: `memento/workbench.parts.editor` (open files + pinned status)
- Selection state: `memento/workbench.editors.files.textFileEditor` (all editor states)

**Features Discovered:**
- Multi-editor group support (splits/tabs)
- Multiple selections per file
- Cross-platform workspace detection
- Real-time editor state parsing

## Important Note: VS Code State Persistence

VS Code does NOT save its state (including selections) immediately. State is persisted when:
- The window loses focus (e.g., switching to another app)
- Files are opened or closed
- The editor is closed
- After certain timeout periods

### Automatic State Refresh

**By default**, vctx automatically refreshes VS Code's state before reading to ensure you get the latest selections. This happens instantly by briefly switching to Finder and back.

To disable automatic refresh (not recommended):
```bash
vctx --no-refresh -sc  # Get selections without refresh
```

**Note**: Without refresh, you may get stale selection data. The auto-refresh is nearly instantaneous and ensures accurate results.