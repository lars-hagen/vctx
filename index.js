#!/usr/bin/env node

const { Command } = require('commander');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

const program = new Command();

// Check if color should be disabled
if (process.argv.includes('--no-color')) {
  chalk.level = 0;
}

// VS Code workspace storage path
const VSCODE_STORAGE = path.join(os.homedir(), 'Library/Application Support/Code/User/workspaceStorage');

// LLM-friendly output formatting
class LLMFormatter {
  static workspace(workspaceInfo) {
    return `${chalk.gray('WORKSPACE:')} ${workspaceInfo.folder}\n${chalk.gray('WORKSPACE_ID:')} ${workspaceInfo.id}\n`;
  }

  static fileList(files, title = "EDITORS", options = {}) {
    if (!files.length) return `${title}: none\n`;
    
    let output = `${chalk.gray(title + ':')}\n`;
    files.forEach((file, index) => {
      const status = [];
      if (file.pinned) status.push(chalk.yellow('[PINNED]'));
      if (file.type === 'terminal') status.push('[TERMINAL]');
      if (file.selections?.length) {
        status.push(chalk.cyan(`[SELECTED:${file.selections.join(',')}]`));
      }
      const statusStr = status.length ? ` ${status.join(' ')}` : '';
      output += `  ${index + 1}. ${file.path}${statusStr}\n`;
      
      // Add full file content if requested (for open/pinned commands) OR if file is pinned
      if ((options.includeContent || (options.includePinnedContent && file.pinned)) && file.type === 'file') {
        try {
          const fs = require('fs');
          if (fs.existsSync(file.path)) {
            const content = fs.readFileSync(file.path, 'utf8');
            const lang = this.getFileLanguage(file.path);
            output += `     \`\`\`${lang}\n`;
            content.split('\n').forEach(line => {
              output += `     ${line}\n`;
            });
            output += `     \`\`\`\n`;
          }
        } catch (err) {
          output += `     [Error reading file: ${err.message}]\n`;
        }
      }
    });
    return output;
  }

  static selections(selections, options = {}) {
    if (!selections.length) return "SELECTIONS: none\n";
    
    let output = "";
    selections.forEach((sel, index) => {
      if (options.legacyFormat) {
        // Original technical format
        output += `  ${index + 1}. ${sel.file}\n`;
        sel.ranges.forEach((range, i) => {
          output += `     ${i + 1}. ${range}\n`;
          
          // Add content if available
          if (sel.content) {
            const contentItem = sel.content.find(c => c.range === range);
            if (contentItem) {
              const lines = contentItem.content.split('\n');
              const lang = this.getFileLanguage(sel.file);
              output += `        \`\`\`${lang}\n`;
              lines.forEach(line => {
                output += `        ${line}\n`;
              });
              output += `        \`\`\`\n`;
            }
          }
        });
      } else {
        // IDE-style format (now default): "The user selected the following lines from [filepath]:"
        output += chalk.magenta(`The user selected the following lines from ${sel.file}:`) + '\n';
        
        // Show actual selected content without technical formatting
        if (sel.content) {
          sel.content.forEach(contentItem => {
            const lines = contentItem.content.split('\n');
            lines.forEach(line => {
              output += chalk.hex('#86efac')(`${line}\n`);
            });
          });
        } else {
          // Fallback to range info if no content
          sel.ranges.forEach(range => {
            output += chalk.hex('#86efac')(`${range}\n`);
          });
        }
        
        // Add separator between files (but not after the last one)
        if (index < selections.length - 1) {
          output += "\n";
        }
      }
    });
    
    if (options.legacyFormat) {
      output = "SELECTIONS:\n" + output;
    }
    
    return output;
  }

  static getFileLanguage(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap = {
      'js': 'javascript',
      'jsx': 'javascript', 
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'sh': 'bash',
      'yml': 'yaml',
      'yaml': 'yaml',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'md': 'markdown'
    };
    return langMap[ext] || 'text';
  }

  static raw(data, options = {}) {
    let output = chalk.blue("=== VS CODE RAW CONTEXT ===") + "\n";
    output += this.workspace(data.workspace);
    output += "\n";
    
    // Filter terminals if not requested
    const openFiles = options.includeTerminals 
      ? data.openFiles 
      : data.openFiles.filter(f => f.type !== 'terminal');
    const pinnedFiles = options.includeTerminals 
      ? data.pinnedFiles 
      : data.pinnedFiles.filter(f => f.type !== 'terminal');
    
    // Smart mode: avoid redundancy
    const smartMode = options.smartMode !== false; // Default to true
    
    // Show open editors (with includePinnedContent set to true by default)
    output += this.fileList(openFiles, "OPEN_EDITORS", {
      ...options,
      includePinnedContent: true  // Always show content for pinned files
    });
    output += "\n";
    
    // Only show pinned section if there are pinned files AND we're not in smart mode
    // In smart mode, pinned status is already shown in OPEN_EDITORS with [PINNED] tag
    if (!smartMode && pinnedFiles.length > 0) {
      output += this.fileList(pinnedFiles, "PINNED_EDITORS", options);
      output += "\n";
    }
    
    // Show selections
    const selectionsOutput = this.selections(data.selections, options);
    if (selectionsOutput && selectionsOutput !== "SELECTIONS: none\n") {
      output += selectionsOutput;
      output += "\n";
    }
    
    // Show summary counts
    output += `${chalk.gray('TOTAL_OPEN:')} ${openFiles.length}\n`;
    if (pinnedFiles.length > 0) {
      output += `${chalk.gray('TOTAL_PINNED:')} ${pinnedFiles.length}\n`;
    }
    if (data.selections.length > 0) {
      output += `${chalk.gray('TOTAL_SELECTED:')} ${data.selections.length}\n`;
    }
    
    output += chalk.blue("=== END RAW CONTEXT ===") + "\n";
    return output;
  }
}

class VSCodeInspector {
  constructor() {
    this.workspaces = [];
  }

  // Extract selected text content from a file
  extractSelectedContent(filePath, ranges) {
    try {
      if (!fs.existsSync(filePath)) return null;
      
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const results = [];

      for (const range of ranges) {
        // Parse range like "L60:C31-37" or "L31:C41-L25:C1"
        const match = range.match(/L(\d+):C(\d+)-(?:L(\d+):C)?(\d+)/);
        if (!match) continue;

        const startLine = parseInt(match[1]) - 1; // Convert to 0-based
        const startCol = parseInt(match[2]) - 1;
        const endLine = match[3] ? parseInt(match[3]) - 1 : startLine;
        const endCol = parseInt(match[4]) - 1;

        let selectedText = '';
        
        if (startLine === endLine) {
          // Single line selection
          if (lines[startLine]) {
            selectedText = lines[startLine].substring(startCol, endCol + 1);
          }
        } else {
          // Multi-line selection
          for (let i = Math.min(startLine, endLine); i <= Math.max(startLine, endLine); i++) {
            if (!lines[i]) continue;
            
            if (i === startLine) {
              selectedText += lines[i].substring(startCol) + '\n';
            } else if (i === endLine) {
              selectedText += lines[i].substring(0, endCol + 1);
            } else {
              selectedText += lines[i] + '\n';
            }
          }
        }

        if (selectedText.trim()) {
          results.push({
            range,
            content: selectedText,
            lineCount: Math.abs(endLine - startLine) + 1
          });
        }
      }

      return results;
    } catch (err) {
      return null;
    }
  }

  async init() {
    if (!fs.existsSync(VSCODE_STORAGE)) {
      throw new Error('VS Code workspace storage not found');
    }
    await this.loadWorkspaces();
  }

  async loadWorkspaces() {
    const dirs = fs.readdirSync(VSCODE_STORAGE);
    
    for (const dir of dirs) {
      const workspacePath = path.join(VSCODE_STORAGE, dir);
      const workspaceJsonPath = path.join(workspacePath, 'workspace.json');
      const stateDbPath = path.join(workspacePath, 'state.vscdb');
      
      if (fs.existsSync(workspaceJsonPath) && fs.existsSync(stateDbPath)) {
        try {
          const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
          const folder = workspaceJson.folder?.replace('file://', '') || null;
          
          if (folder) {
            this.workspaces.push({
              id: dir,
              folder,
              stateDbPath
            });
          }
        } catch (err) {
          // Skip invalid workspace
        }
      }
    }
  }

  findWorkspaceByFile(filePath) {
    const normalizedPath = path.resolve(filePath);
    return this.workspaces.find(ws => normalizedPath.startsWith(ws.folder));
  }

  queryDatabase(dbPath, query) {
    try {
      const result = execSync(`sqlite3 "${dbPath}" "${query}"`, { 
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large results
      });
      return result.trim() ? { value: result.trim() } : null;
    } catch (err) {
      return null;
    }
  }

  async getOpenFiles(workspace) {
    try {
      const result = this.queryDatabase(
        workspace.stateDbPath,
        "SELECT value FROM ItemTable WHERE key = 'memento/workbench.parts.editor'"
      );

      if (!result?.value) return [];

      const editorState = JSON.parse(result.value);
      const files = [];

      const gridData = editorState['editorpart.state']?.serializedGrid?.root?.data || [];
      
      // Recursively process grid data (can have nested branches)
      const processGridData = (data) => {
        for (const group of data) {
          if (group.type === 'leaf' && group.data?.editors) {
            const sticky = group.data.sticky;
            
            group.data.editors.forEach((editor, index) => {
              if (editor.value) {
                try {
                  if (editor.id === 'workbench.editors.files.fileEditorInput') {
                    // Regular file editor
                    const editorData = JSON.parse(editor.value);
                    const filePath = editorData.resourceJSON?.fsPath;
                    
                    if (filePath) {
                      files.push({
                        path: filePath,
                        type: 'file',
                        pinned: sticky !== null && sticky !== undefined && index <= sticky,
                        groupId: group.data.id,
                        index
                      });
                    }
                  } else if (editor.id === 'workbench.editors.terminal') {
                    // Terminal editor
                    const terminalData = JSON.parse(editor.value);
                    
                    // Get real-time CWD from process
                    let realCwd = '';
                    if (terminalData.pid) {
                      try {
                        const lsofOutput = execSync(`lsof -p ${terminalData.pid} | grep cwd`, { 
                          encoding: 'utf8',
                          timeout: 1000
                        });
                        const match = lsofOutput.match(/cwd\s+DIR\s+[\d,]+\s+\d+\s+\d+\s+(.+)/);
                        realCwd = match ? match[1].trim() : '';
                      } catch (err) {
                        // Process might not exist or lsof failed
                      }
                    }
                    
                    const cwdDisplay = realCwd ? ` @ ${realCwd}` : '';
                    files.push({
                      path: `Terminal: ${terminalData.title || 'Unknown'} (PID: ${terminalData.pid || 'N/A'})${cwdDisplay}`,
                      type: 'terminal',
                      pinned: sticky !== null && sticky !== undefined && index <= sticky,
                      groupId: group.data.id,
                      index,
                      metadata: {
                        pid: terminalData.pid,
                        title: terminalData.title,
                        cwd: realCwd || terminalData.cwd || '',
                        id: terminalData.id
                      }
                    });
                  }
                } catch (err) {
                  // Skip invalid editor data
                }
              }
            });
          } else if (group.type === 'branch' && group.data) {
            // Recursively process nested branches
            processGridData(group.data);
          }
        }
      };
      
      processGridData(gridData);

      return files;
    } catch (err) {
      return [];
    }
  }

  async getActiveFile(workspace) {
    try {
      const result = this.queryDatabase(
        workspace.stateDbPath,
        "SELECT value FROM ItemTable WHERE key = 'memento/workbench.parts.editor'"
      );

      if (!result?.value) return null;

      const editorState = JSON.parse(result.value);
      const activeGroup = editorState['editorpart.state']?.activeGroup;
      const gridData = editorState['editorpart.state']?.serializedGrid?.root?.data || [];
      
      // Find the active group
      for (const group of gridData) {
        if (group.type === 'leaf' && group.data?.id === activeGroup) {
          const mru = group.data.mru || [];
          const activeIndex = mru[0];
          
          if (activeIndex !== undefined && group.data.editors?.[activeIndex]) {
            const editor = group.data.editors[activeIndex];
            
            // Check if it's a file editor
            if (editor.id === 'workbench.editors.files.fileEditorInput' && editor.value) {
              const editorData = JSON.parse(editor.value);
              return editorData.resourceJSON?.fsPath || null;
            }
          }
          break;
        }
      }
      
      return null; // No file is currently visible (could be terminal, output, etc.)
    } catch (err) {
      return null;
    }
  }

  async getSelections(workspace) {
    try {
      const result = this.queryDatabase(
        workspace.stateDbPath,
        "SELECT value FROM ItemTable WHERE key = 'memento/workbench.editors.files.textFileEditor'"
      );

      if (!result?.value) return [];

      const viewState = JSON.parse(result.value);
      const selections = [];

      for (const [filePath, states] of viewState.textEditorViewState || []) {
        const cleanPath = filePath.replace('file://', '');
        const ranges = [];

        // Check all editor states for this file
        for (const [stateKey, state] of Object.entries(states)) {
          const cursorState = state.cursorState?.[0];
          // Only process if explicitly in selection mode and selection is different from cursor position
          if (cursorState?.inSelectionMode === true) {
            const start = cursorState.selectionStart;
            const end = cursorState.position;
            
            // Ensure we have valid selection data and it's actually a selection (not just a cursor)
            if (start && end && (start.lineNumber !== end.lineNumber || start.column !== end.column)) {
              // Handle backward selections (when user selects from right to left)
              const isBackward = (start.lineNumber > end.lineNumber) || 
                                (start.lineNumber === end.lineNumber && start.column > end.column);
              
              const actualStart = isBackward ? end : start;
              const actualEnd = isBackward ? start : end;
              
              if (actualStart.lineNumber === actualEnd.lineNumber) {
                ranges.push(`L${actualStart.lineNumber}:C${actualStart.column}-${actualEnd.column}`);
              } else {
                ranges.push(`L${actualStart.lineNumber}:C${actualStart.column}-L${actualEnd.lineNumber}:C${actualEnd.column}`);
              }
            }
          }
        }

        if (ranges.length > 0) {
          selections.push({ file: cleanPath, ranges });
        }
      }

      return selections;
    } catch (err) {
      return [];
    }
  }

  // Force VS Code to save its state by switching applications
  static forceStateRefresh() {
    try {
      // Switch to Finder and back to VS Code as fast as possible
      execSync(`osascript -e 'tell application "Finder" to activate' && osascript -e 'tell application "Visual Studio Code" to activate'`);
      // Minimal delay for state to persist
      execSync('sleep 0.2');
      return true;
    } catch (err) {
      return false;
    }
  }

  async getRawContext(filePath, options = {}) {
    const workspace = this.findWorkspaceByFile(filePath);
    if (!workspace) {
      throw new Error(`No workspace found for file: ${filePath}`);
    }

    // Force refresh by default (unless explicitly disabled)
    if (options.forceRefresh !== false) {
      VSCodeInspector.forceStateRefresh();
    }

    const [openFiles, selections, activeFile] = await Promise.all([
      this.getOpenFiles(workspace),
      this.getSelections(workspace),
      this.getActiveFile(workspace)
    ]);

    // Add selection info to open files (only for file types, not terminals)
    openFiles.forEach(file => {
      if (file.type === 'file') {
        const fileSelections = selections.find(s => s.file === file.path);
        file.selections = fileSelections?.ranges || [];
      }
    });

    // Extract content for selections if requested
    if (options.includeContent) {
      selections.forEach(selection => {
        const content = this.extractSelectedContent(selection.file, selection.ranges);
        if (content) {
          selection.content = content;
        }
      });
    }

    const pinnedFiles = openFiles.filter(f => f.pinned);
    
    // Filter selections based on context
    let filteredSelections;
    if (options.allSelections) {
      // Show all selections from open files (old behavior)
      const openFilePaths = openFiles.map(f => f.path);
      filteredSelections = selections.filter(s => openFilePaths.includes(s.file));
    } else {
      // Default: only show selections from the currently visible file
      filteredSelections = activeFile ? selections.filter(s => s.file === activeFile) : [];
    }

    return {
      workspace: {
        id: workspace.id,
        folder: workspace.folder
      },
      openFiles,
      pinnedFiles,
      selections: filteredSelections,
      activeFile // Include this for debugging/awareness
    };
  }
}

// CLI Commands
program
  .name('vctx')
  .usage('[options]')
  .description('VS Code context extractor for Claude')
  .version('1.0.0')
  .option('-j, --json', 'Output in JSON format')
  .option('-c, --content', 'Include full file content for all open files')
  .option('-t, --terminals', 'Include terminals in output')
  .option('--legacy-format', 'Use legacy selection format')
  .option('--all-selections', 'Show selections from all open files (not just visible)')
  .option('--no-smart', 'Show all sections (including redundant)')
  .option('--no-refresh', 'Skip automatic state refresh')
  .option('--no-color', 'Disable colored output')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const termWidth = process.stdout.columns || 80;
      const indent = '  ';
      
      let help = '';
      
      // Title
      help += `vctx - ${cmd.description()}\n\n`;
      
      // Usage
      help += 'Usage: vctx [options]\n\n';
      
      // Quick commands
      help += 'Quick Commands:\n';
      const quickCmds = [
        ['-r', 'Full context (raw)'],
        ['-s', 'Text selections'],
        ['-o', 'Open files'],
        ['-p', 'Pinned files'],
        ['-w', 'Workspace info'],
        ['-rc', 'Raw + content'],
        ['-sc', 'Selections + content'],
        ['-oc', 'Open files + content'],
        ['-pc', 'Pinned + content']
      ];
      quickCmds.forEach(([cmd, desc]) => {
        if (cmd) help += `${indent}${cmd.padEnd(8)} ${desc}\n`;
        else help += '\n';
      });
      
      help += '\nOptions:\n';
      const opts = [
        ['-j, --json', 'JSON output'],
        ['-t, --terminals', 'Include terminals'],
        ['--all-selections', 'Show all file selections'],
        ['--no-refresh', 'Skip auto-refresh'],
        ['--no-smart', 'Show all sections'],
        ['--legacy-format', 'Old selection format']
      ];
      opts.forEach(([opt, desc]) => {
        help += `${indent}${opt.padEnd(20)} ${desc}\n`;
      });
      
      help += '\nExamples:\n';
      help += `${indent}vctx        # Full context\n`;
      help += `${indent}vctx -sc    # Selections with content\n`;
      help += `${indent}vctx -o     # Just open files\n`;
      
      help += '\nNotes:\n';
      help += `${indent}• Auto-refreshes VS Code state (brief app switch)\n`;
      help += `${indent}• Shows selections from visible file only (use --all-selections for all)\n`;
      help += `${indent}• File paths default to current directory\n`;
      
      return help;
    }
  });

program
  .command('raw')
  .description('Full raw context for Claude (recommended)')
  .argument('<file>', 'File path to find workspace')
  .action(async (filePath, options) => {
    try {
      const inspector = new VSCodeInspector();
      await inspector.init();
      
      const globalOpts = program.opts();
      const context = await inspector.getRawContext(filePath, {
        includeContent: globalOpts.content !== false,  // Default to true
        forceRefresh: globalOpts.refresh,
        allSelections: globalOpts.allSelections
      });
      
      if (globalOpts.json) {
        console.log(JSON.stringify(context, null, 2));
      } else {
        console.log(LLMFormatter.raw(context, {
          includeTerminals: globalOpts.terminals,
          includeContent: globalOpts.content,
          legacyFormat: globalOpts.legacyFormat,
          smartMode: globalOpts.smart
        }));
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('open')
  .description('Show open files in workspace')
  .argument('<file>', 'File path to find workspace')
  .action(async (filePath) => {
    try {
      const inspector = new VSCodeInspector();
      await inspector.init();
      
      const globalOpts = program.opts();
      const context = await inspector.getRawContext(filePath, {
        includeContent: globalOpts.content !== false,  // Default to true
        forceRefresh: globalOpts.refresh,
        allSelections: globalOpts.allSelections
      });
      
      // Filter out terminals unless -t flag is used
      const files = globalOpts.terminals 
        ? context.openFiles 
        : context.openFiles.filter(f => f.type !== 'terminal');
      
      console.log(LLMFormatter.fileList(files, "OPEN_EDITORS", {
        includeContent: globalOpts.content
      }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('pinned')
  .description('Show pinned files in workspace')
  .argument('<file>', 'File path to find workspace')
  .action(async (filePath) => {
    try {
      const inspector = new VSCodeInspector();
      await inspector.init();
      
      const globalOpts = program.opts();
      const context = await inspector.getRawContext(filePath, {
        includeContent: globalOpts.content !== false,  // Default to true
        forceRefresh: globalOpts.refresh,
        allSelections: globalOpts.allSelections
      });
      
      // Filter out terminals unless -t flag is used
      const files = globalOpts.terminals 
        ? context.pinnedFiles 
        : context.pinnedFiles.filter(f => f.type !== 'terminal');
      
      console.log(LLMFormatter.fileList(files, "PINNED_EDITORS", {
        includeContent: globalOpts.content
      }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('selections')
  .description('Show text selections in workspace')
  .argument('<file>', 'File path to find workspace')
  .action(async (filePath) => {
    try {
      const inspector = new VSCodeInspector();
      await inspector.init();
      
      const globalOpts = program.opts();
      const context = await inspector.getRawContext(filePath, {
        includeContent: globalOpts.content !== false,  // Default to true
        forceRefresh: globalOpts.refresh,
        allSelections: globalOpts.allSelections
      });
      
      console.log(LLMFormatter.selections(context.selections, {
        legacyFormat: globalOpts.legacyFormat
      }));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('workspace')
  .description('Show workspace info')
  .argument('<file>', 'File path to find workspace')
  .action(async (filePath) => {
    try {
      const inspector = new VSCodeInspector();
      await inspector.init();
      const context = await inspector.getRawContext(filePath);
      console.log(LLMFormatter.workspace(context.workspace));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// Custom shorthand handler
function handleShorthands(args) {
  // Check if first arg after script is a shorthand flag
  const firstArg = args[2];
  if (!firstArg || !firstArg.startsWith('-') || firstArg === '--help' || firstArg === '-h' || firstArg === '--version' || firstArg === '-V') {
    return args;
  }

  // Skip standard commander option flags (let commander handle them)
  if (firstArg === '-j' || firstArg === '--json' || 
      firstArg === '-t' || firstArg === '--terminals' ||
      firstArg === '--legacy-format' || firstArg === '--no-smart' || 
      firstArg === '--no-refresh' || firstArg === '--no-content' ||
      firstArg === '--no-color') {
    return args;
  }

  // Special case for -c alone (content flag) - only if it's the only flag
  if (firstArg === '-c' && (!args[3] || !args[3].startsWith('-'))) {
    return [args[0], args[1], '--content', 'raw', args[3] || process.cwd()];
  }
  
  // Check if it's a shorthand command (e.g., -r, -rc, -sc, -oc, -oct)
  const shorthandMatch = firstArg.match(/^-([ropws])([ct]*)$/);
  if (!shorthandMatch) {
    // Not a recognized shorthand, let commander handle it
    return args;
  }

  const [, command, modifiers] = shorthandMatch;
  const filePath = args[3] || process.cwd(); // Default to current working directory

  // Map shorthand to full command
  const commandMap = {
    'r': 'raw',
    'o': 'open',
    'p': 'pinned',
    's': 'selections',
    'w': 'workspace'
  };

  const fullCommand = commandMap[command];
  if (!fullCommand) {
    return args;
  }

  // Reconstruct args with full command
  const newArgs = [args[0], args[1]];
  
  if (modifiers.includes('c')) {
    newArgs.push('--content');
  }
  
  if (modifiers.includes('t')) {
    newArgs.push('--terminals');
  }
  
  newArgs.push(fullCommand, filePath);
  
  // Add any additional args
  for (let i = 4; i < args.length; i++) {
    newArgs.push(args[i]);
  }
  
  return newArgs;
}

if (require.main === module) {
  const processedArgs = handleShorthands(process.argv);
  
  // If no command is provided, default to raw
  if (processedArgs.length === 2) {
    processedArgs.push('raw', process.cwd());
  }
  
  // If just a single option flag without command, add raw command and path
  if (processedArgs.length === 3 && processedArgs[2].startsWith('-') && 
      !processedArgs[2].match(/^-[ropws]/)) {
    processedArgs.push('raw', process.cwd());
  }
  
  program.parse(processedArgs);
}

module.exports = { VSCodeInspector, LLMFormatter };