
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const OPENING = new Set(['(', '[', '{']);
const CLOSING_TO_OPENING = {
  ')': '(',
  ']': '[',
  '}': '{'
};

// Keywords for IntelliSense
const KEYWORDS = [
  'if', 'unless', 'elif', 'else', 'otherwise', 'ifcase', 'case', 'default',
  'def', 'import', 'with', 'new', 'break', 'return', 'then', 'end',
  'dict', 'locked', 'conf', 'yield', 'yeild',
  'readln', 'input', 'print', 'awaitval',
  'nopoly', 'const', 'str', 'string', 'int', 'flt', 'arr', 'null',
  'as', 'each', 'in', 'do', 'enum', 'map', 'fluc', 'asa'
];

// Built-in functions for IntelliSense
const BUILTIN_FUNCTIONS = [
  'Print', 'Input', 'ReadLn', 'Max', 'Min', 'exit', 'debug', 'breakpoint',
  'yield', 'yeild', 'store', 'request', 'map'
];

const POINT_DECL_RE = /^\s*\(\*([A-Za-z_][A-Za-z0-9_]*)\:?\)\s*awaitval\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)/i;
const LEGACY_POINT_CASE_RE = /^\s*\*([A-Za-z_][A-Za-z0-9_]*)\s+ifcase\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)\s*$/i;
const CONF_RE = /^\s*conf\s+[A-Za-z_][A-Za-z0-9_]*\s*:?\s*$/i;
const AS_LOOP_RE = /^\s*as\s*\(\s*.+\s*\)\s*:\s*$/i;
const EACH_LOOP_RE = /^\s*each\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+in\s+.+\)\s*do\s*:\s*$/i;
const YIELD_DISPATCH_RE = /^\s*(?:yield|yeild)\s+.+\s*(?:>>|<<)\s*(?:\*?\s*[A-Za-z_][A-Za-z0-9_]*|this)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*;?\s*$/i;
const YIELD_CALL_RE = /^\s*(?:yield|yeild)\s*\(\s*.+\s*(?:>>|<<)\s*.+\)\s*;?\s*$/i;
const RETURN_POINT_RE = /^\s*return\b.+(?:>>|<<)\s*\(?\s*(?:\*?\s*[A-Za-z_][A-Za-z0-9_]*|this)\s*\)?\s*;?\s*$/i;
const STORE_RE = /^\s*store\s*\(\s*.+\s+asa\s+[A-Za-z_][A-Za-z0-9_]*\s*>>\s*\*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*;?\s*$/i;
const REQUEST_RE = /^\s*request\s*\(\s*.+\s*<<\s*\*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*;?\s*$/i;
const DEF_DECL_RE = /^def\s+[A-Za-z_][A-Za-z0-9_]*/i;
const DEF_DECL_CAPTURE_RE = /^def\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const IF_HEADER_ACTION_RE = /^(if|unless|elif|else|otherwise)\b.*::\s*(.+)$/i;
const VAR_DECL_CAPTURE_RE = /^\s*(?:(?:nopoly|const)\s+)*(?:(int|flt|str|string|arr(?:\[[^\]]+\])?|dict|conf)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/i;
const DICT_DECL_CAPTURE_RE = /^\s*(?:locked\s+)?dict\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i;
const CONF_DECL_CAPTURE_RE = /^\s*conf\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i;
const NEW_DECL_CAPTURE_RE = /^\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i;
const IMPORT_CAPTURE_RE = /^\s*(?:with|import)\s+(.+)$/i;

const BARE_ASSIGNMENT_RE = /(^|[^=!<>])=($|[^=>])/;
const CALL_CAPTURE_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const NON_FUNCTION_CALLS = new Set([
  'if', 'elif', 'ifcase', 'as', 'each', 'awaitval', 'store', 'request',
  'yield', 'yeild', 'return', 'print', 'input', 'readln', 'max', 'min',
  'exit', 'conf', 'debug', 'breakpoint'
]);

const KEYWORD_DOCS = {
  if: {
    detail: 'Conditional branch',
    documentation: 'Checks a condition and runs the body when it is truthy.\n\nPreferred form:\n`if (condition)::then { ... }`'
  },
  unless: {
    detail: 'Negated conditional',
    documentation: 'Equivalent to `if (!condition)`.\n\nUseful when the negative case reads more clearly.'
  },
  elif: {
    detail: 'Else-if branch',
    documentation: 'Adds another conditional branch after an `if`.'
  },
  else: {
    detail: 'Fallback branch',
    documentation: 'Runs when previous `if`/`elif` branches did not match.'
  },
  otherwise: {
    detail: 'Fallback alias',
    documentation: 'Acts like `else`, and is also used as the default branch in `IfCase`.'
  },
  ifcase: {
    detail: 'Switch-style branch',
    documentation: 'Matches one subject value against grouped `Case:` clauses.\n\nUse when several discrete values should share a branch.'
  },
  case: {
    detail: 'IfCase branch',
    documentation: 'Defines one match arm inside `IfCase`.\n\nGrouped form: `Case:(A, B, C):`'
  },
  def: {
    detail: 'Function declaration',
    documentation: 'Declares a callable function.\n\nStill supported, but the docs mark it as legacy compared to points.'
  },
  with: {
    detail: 'Module or plugin import',
    documentation: 'Imports another Doe module or a plugin.\n\nExamples:\n`with Dough-2d`\n`with plugin:Dough-2d`'
  },
  new: {
    detail: 'Array-style constructor',
    documentation: 'Creates a named array-like value using a type tag.\n\nExample:\n`new windowtype landscape: { 1080, 960, "Title" }`'
  },
  dict: {
    detail: 'Dictionary declaration',
    documentation: 'Creates a runtime dictionary.\n\nUse field access like `window.title` after construction.'
  },
  conf: {
    detail: 'Config declaration',
    documentation: 'Declares an importable config dictionary intended for composition with `map(...)`.'
  },
  yield: {
    detail: 'Point dispatch',
    documentation: 'Sends a value to a point handler.\n\nExamples:\n`yield(value >> *Point)`\n`value >> *Point`'
  },
  yeild: {
    detail: 'Legacy yield spelling',
    documentation: 'Accepted for compatibility. Prefer `yield` in new code.'
  },
  awaitval: {
    detail: 'Point parameter binder',
    documentation: 'Defines the parameter received by a point handler.\n\nExample:\n`(*Log:) awaitval(msg;) { ... }`'
  },
  as: {
    detail: 'While-style loop',
    documentation: 'Repeatedly runs a block while the condition stays truthy.\n\nForm:\n`as(@true): { ... }`'
  },
  each: {
    detail: 'For-each loop',
    documentation: 'Iterates through an array or dictionary values.\n\nForm:\n`each(item in arr) do: { ... }`'
  },
  map: {
    detail: 'Dictionary/config mapper',
    documentation: 'Built-in helper for merging configs or projecting selected keys.\n\nExamples:\n`map(base, overlay)`\n`map(window, "width", "title")`'
  },
  int: {
    detail: 'Integer type',
    documentation: 'Declares an integer variable or config field.'
  },
  flt: {
    detail: 'Floating-point type',
    documentation: 'Declares a numeric value that may contain decimals.'
  },
  str: {
    detail: 'String type',
    documentation: 'Declares a text value.'
  },
  arr: {
    detail: 'Array type',
    documentation: 'Declares an array.\n\nTyped form: `arr[str] names`'
  },
  const: {
    detail: 'Constant modifier',
    documentation: 'Prevents reassignment after initialization.'
  },
  nopoly: {
    detail: 'NoPoly modifier',
    documentation: 'Preserves the declared type instead of allowing polymorphic reassignment.'
  },
  null: {
    detail: 'Null value',
    documentation: 'Represents the absence of a value.'
  }
};

const FUNCTION_DOCS = {
  print: {
    signature: 'Print(value)',
    documentation: 'Writes a value to standard output.'
  },
  input: {
    signature: 'Input(prompt)',
    documentation: 'Prompts the user and returns the entered text.'
  },
  readln: {
    signature: 'ReadLn(index)',
    documentation: 'Reads a line by index from console input history.'
  },
  max: {
    signature: 'Max(a, b, ...)',
    documentation: 'Returns the largest numeric argument, or array size when passed one array.'
  },
  min: {
    signature: 'Min(a, b, ...)',
    documentation: 'Returns the smallest numeric argument, or the lowest Doe index for an array.'
  },
  map: {
    signature: 'map(dict, overlayDict) | map(dict, "key1", "key2")',
    documentation: 'Merges dictionaries/configs or projects named values into an array.'
  },
  exit: {
    signature: 'exit(*PointName)',
    documentation: 'Removes a point handler registration.'
  },
  debug: {
    signature: 'debug()',
    documentation: 'Triggers the runtime debugger when running with `--debug`.'
  },
  breakpoint: {
    signature: 'breakpoint()',
    documentation: 'Alias for a debugger stop point.'
  }
};

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('dough-syntax');
  context.subscriptions.push(diagnostics);

  // Register IntelliSense providers
  const completionProvider = vscode.languages.registerCompletionItemProvider('dough', {
    provideCompletionItems(document, position) {
      const importCompletions = collectImportCompletions(document, position);
      if (importCompletions) {
        return importCompletions;
      }

      const memberCompletions = collectMemberCompletions(document, position);
      if (memberCompletions) {
        return memberCompletions;
      }

      const completions = [];
      const symbols = collectDocumentSymbols(document);

      for (const keyword of KEYWORDS) {
        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
        const doc = KEYWORD_DOCS[keyword.toLowerCase()];
        item.detail = doc ? doc.detail : `Keyword: ${keyword}`;
        if (doc) {
          item.documentation = new vscode.MarkdownString(doc.documentation);
        }
        item.insertText = keyword;
        item.sortText = `1_${keyword}`;
        completions.push(item);
      }

      for (const func of BUILTIN_FUNCTIONS) {
        const item = new vscode.CompletionItem(func, vscode.CompletionItemKind.Function);
        const doc = FUNCTION_DOCS[func.toLowerCase()];
        item.detail = doc ? doc.signature : `Built-in function: ${func}`;
        if (doc) {
          item.documentation = new vscode.MarkdownString(doc.documentation);
        }
        item.insertText = func + '($0)';
        item.insertTextFormat = vscode.InsertTextFormat.Snippet;
        item.sortText = `1_${func}`;
        completions.push(item);
      }
      
      // Add type keywords with detail
      const typeKeywords = [
        { label: 'int', detail: 'Integer type' },
        { label: 'flt', detail: 'Float type' },
        { label: 'str', detail: 'String type' },
        { label: 'arr', detail: 'Array type' },
        { label: 'dict', detail: 'Dictionary type' },
        { label: 'const', detail: 'Constant modifier' },
        { label: 'nopoly', detail: 'NoPoly type hint' }
      ];
      
      for (const type of typeKeywords) {
        const item = new vscode.CompletionItem(type.label, vscode.CompletionItemKind.TypeParameter);
        item.detail = type.detail;
        item.documentation = new vscode.MarkdownString((KEYWORD_DOCS[type.label] || {}).documentation || type.detail);
        item.sortText = `1_${type.label}`;
        completions.push(item);
      }

      for (const symbol of symbols) {
        const item = new vscode.CompletionItem(symbol.label, symbol.kind);
        item.detail = symbol.detail;
        item.documentation = new vscode.MarkdownString(symbol.documentation);
        item.insertText = symbol.insertText || symbol.label;
        item.sortText = `0_${symbol.label}`;
        completions.push(item);
      }
      
      // Add point declaration snippet
      const pointSnippet = new vscode.CompletionItem('(*point:) awaitval(val;)', vscode.CompletionItemKind.Snippet);
      pointSnippet.detail = 'Point declaration';
      pointSnippet.insertText = '(*${1:pointName}:) awaitval(${2:value};) {\n\t$0\n}';
      pointSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(pointSnippet);
      
      // Add if statement snippet
      const ifSnippet = new vscode.CompletionItem('if (condition)', vscode.CompletionItemKind.Snippet);
      ifSnippet.detail = 'If statement';
      ifSnippet.insertText = 'if (${1:condition}) {\n\t$0\n}';
      ifSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(ifSnippet);

      const unlessSnippet = new vscode.CompletionItem('unless (condition)', vscode.CompletionItemKind.Snippet);
      unlessSnippet.detail = 'Negated if statement';
      unlessSnippet.insertText = 'unless (${1:condition})::then\n{\n\t$0\n}';
      unlessSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(unlessSnippet);
      
      // Add if-else snippet
      const ifElseSnippet = new vscode.CompletionItem('if-else', vscode.CompletionItemKind.Snippet);
      ifElseSnippet.detail = 'If-else statement';
      ifElseSnippet.insertText = 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}';
      ifElseSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(ifElseSnippet);
      
      // Add yield statement snippet
      const yieldSnippet = new vscode.CompletionItem('yield >> *point', vscode.CompletionItemKind.Snippet);
      yieldSnippet.detail = 'Yield dispatch';
      yieldSnippet.insertText = 'yield(${1:value} >> *${2:pointName})';
      yieldSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(yieldSnippet);
      
      // Add each loop snippet
      const eachSnippet = new vscode.CompletionItem('each (item in iterable)', vscode.CompletionItemKind.Snippet);
      eachSnippet.detail = 'Each loop';
      eachSnippet.insertText = 'each (${1:item} in ${2:iterable}) do:\n\t$0';
      eachSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(eachSnippet);
      
      // Add as loop snippet
      const asSnippet = new vscode.CompletionItem('as (condition)', vscode.CompletionItemKind.Snippet);
      asSnippet.detail = 'As loop';
      asSnippet.insertText = 'as(${1:condition}):\n\t$0';
      asSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(asSnippet);
      
      // Add ifcase snippet
      const ifCaseSnippet = new vscode.CompletionItem('ifcase (expr)', vscode.CompletionItemKind.Snippet);
      ifCaseSnippet.detail = 'IfCase statement';
      ifCaseSnippet.insertText = 'ifcase (${1:expression}) {\n\tcase:(${2:One}, ${3:Two}):\n\t{\n\t\t$0\n\t}\n\totherwise:\n\t{\n\t\t\n\t}\n}';
      ifCaseSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(ifCaseSnippet);

      const withSnippet = new vscode.CompletionItem('with module', vscode.CompletionItemKind.Snippet);
      withSnippet.detail = 'Import alias';
      withSnippet.insertText = 'with ${1:module.name}';
      withSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(withSnippet);

      const newSnippet = new vscode.CompletionItem('new type name', vscode.CompletionItemKind.Snippet);
      newSnippet.detail = 'Array-style constructor declaration';
      newSnippet.insertText = 'new ${1:type} ${2:name}: {\n\t${3:value1},\n\t${4:value2}\n}';
      newSnippet.insertTextFormat = vscode.InsertTextFormat.Snippet;
      completions.push(newSnippet);
      
      return completions;
    }
  }, '.', ':');
  context.subscriptions.push(completionProvider);

  // Register hover provider
  const hoverProvider = vscode.languages.registerHoverProvider('dough', {
    provideHover(document, position) {
      const word = document.getWordRangeAtPosition(position);
      if (!word) return null;
      
      const text = document.getText(word);

      const symbolHover = createSymbolHover(document, text);
      if (symbolHover) {
        return symbolHover;
      }

      const keywordDoc = KEYWORD_DOCS[text.toLowerCase()];
      if (keywordDoc) {
        return new vscode.Hover(new vscode.MarkdownString(`**${text}**\n\n${keywordDoc.documentation}`));
      }

      const funcDoc = FUNCTION_DOCS[text.toLowerCase()];
      if (funcDoc) {
        return new vscode.Hover(new vscode.MarkdownString(`**${funcDoc.signature}**\n\n${funcDoc.documentation}`));
      }

      return null;
    }
  });
  context.subscriptions.push(hoverProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('dough.runCurrentFile', () => runOrDebugCurrentFile(false)),
    vscode.commands.registerCommand('dough.debugCurrentFile', () => runOrDebugCurrentFile(true))
  );

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('dough', {
      resolveDebugConfiguration(folder, config) {
        const programPath = resolveProgramPath(config.program);
        if (!programPath) {
          vscode.window.showErrorMessage('Open a .doe/.dough file first.');
          return undefined;
        }

        const runtime = resolveRuntimeCommand(folder, config.runtimeCommand, programPath);
        const debugFlag = config.debugFlag || '--debug';
        const command = config.command || `${runtime} ${debugFlag} "${programPath}"`;

        return {
          type: 'node-terminal',
          request: 'launch',
          name: config.name || 'Dough: Debug Current File',
          command
        };
      }
    })
  );

  const validate = (document) => {
    if (document.languageId !== 'dough') {
      return;
    }

    diagnostics.set(document.uri, computeDiagnostics(document));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((e) => validate(e.document)),
    vscode.workspace.onDidSaveTextDocument(validate),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
  );

  for (const doc of vscode.workspace.textDocuments) {
    validate(doc);
  }
}

function deactivate() {}

function runOrDebugCurrentFile(debug) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a .doe/.dough file first.');
    return;
  }

  const doc = editor.document;
  const ext = doc.fileName.toLowerCase();
  if (doc.languageId !== 'dough' && !ext.endsWith('.doe') && !ext.endsWith('.dough')) {
    vscode.window.showErrorMessage('Current file is not a Dough source file.');
    return;
  }

  const folder = getOwningWorkspaceFolder(doc.uri);
  const runtime = resolveRuntimeCommand(folder, null, doc.fileName);
  const debugFlag = debug ? '--debug ' : '';
  const command = `${runtime} ${debugFlag}"${doc.fileName}"`;
  const cwd = determineCwd(folder, doc.fileName);

  const terminalName = debug ? 'Dough Debugger' : 'Dough Runner';
  const terminal = vscode.window.createTerminal({ name: terminalName, cwd });
  terminal.show(true);
  terminal.sendText(command);
}

function resolveProgramPath(configProgram) {
  if (configProgram && configProgram !== '${file}') {
    return configProgram;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const doc = editor.document;
  const ext = doc.fileName.toLowerCase();
  if (doc.languageId !== 'dough' && !ext.endsWith('.doe') && !ext.endsWith('.dough')) {
    return null;
  }

  return doc.fileName;
}

function resolveRuntimeCommand(folder, explicitRuntime, programPath) {
  if (explicitRuntime && explicitRuntime.trim().length > 0) {
    return explicitRuntime.trim();
  }

  const root = folder && folder.uri
    ? folder.uri.fsPath
    : findProjectRootFromProgram(programPath);

  if (root) {
    const cmdWrapper = path.join(root, 'dough.cmd');
    if (fs.existsSync(cmdWrapper)) {
      return `"${cmdWrapper}"`;
    }

    const psWrapper = path.join(root, 'dough.ps1');
    if (fs.existsSync(psWrapper)) {
      return `powershell -NoProfile -ExecutionPolicy Bypass -File "${psWrapper}"`;
    }

    const projectPath = path.join(root, 'Other_Bullshit', 'Doe-Language.csproj');
    if (fs.existsSync(projectPath)) {
      return `dotnet run --project "${projectPath}" --`;
    }
  }

  if (looksRunnableCommand('dough')) {
    return 'dough';
  }

  return 'dough';
}

function looksRunnableCommand(command) {
  if (!command || command.trim().length === 0) {
    return false;
  }

  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    childProcess.execFileSync(probe, [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getOwningWorkspaceFolder(uri) {
  if (!uri) {
    return null;
  }

  return vscode.workspace.getWorkspaceFolder(uri) || null;
}

function determineCwd(folder, programPath) {
  if (folder && folder.uri) {
    return folder.uri.fsPath;
  }

  if (programPath) {
    return path.dirname(programPath);
  }

  return undefined;
}

function findProjectRootFromProgram(programPath) {
  if (!programPath) {
    return null;
  }

  let current = path.dirname(programPath);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(current, 'Other_Bullshit', 'Doe-Language.csproj');
    if (fs.existsSync(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

function collectDocumentSymbols(document) {
  const symbols = [];
  const seen = new Set();
  const lines = document.getText().split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const raw = stripLineCommentPreserveQuotes(lines[li]);
    const line = raw.trim();
    if (!line) {
      continue;
    }

    const functionDecl = line.match(DEF_DECL_CAPTURE_RE);
    if (functionDecl) {
      pushSymbol(symbols, seen, {
        label: functionDecl[1],
        kind: vscode.CompletionItemKind.Function,
        detail: `Function defined in this file at line ${li + 1}`,
        documentation: `User-defined function.\n\nDeclared as:\n\`def ${functionDecl[1]}(...)\``,
        insertText: `${functionDecl[1]}($0)`
      });
    }

    const confDecl = line.match(CONF_DECL_CAPTURE_RE);
    if (confDecl) {
      pushSymbol(symbols, seen, {
        label: confDecl[1],
        kind: vscode.CompletionItemKind.Struct,
        detail: `Config declared at line ${li + 1}`,
        documentation: `Config dictionary.\n\nUse \`map(${confDecl[1]})\` to clone or compose it.`
      });
    }

    const dictDecl = line.match(DICT_DECL_CAPTURE_RE);
    if (dictDecl) {
      pushSymbol(symbols, seen, {
        label: dictDecl[1],
        kind: vscode.CompletionItemKind.Struct,
        detail: `Dictionary declared at line ${li + 1}`,
        documentation: `Dictionary value declared in this file.`
      });
    }

    const varDecl = line.match(VAR_DECL_CAPTURE_RE);
    if (varDecl) {
      const typeName = varDecl[1] || 'value';
      pushSymbol(symbols, seen, {
        label: varDecl[2],
        kind: vscode.CompletionItemKind.Variable,
        detail: `${typeName} declared at line ${li + 1}`,
        documentation: `Variable declared in this file.\n\nDeclared type: \`${typeName}\``
      });
    }

    const newDecl = line.match(NEW_DECL_CAPTURE_RE);
    if (newDecl) {
      pushSymbol(symbols, seen, {
        label: newDecl[2],
        kind: vscode.CompletionItemKind.Array,
        detail: `${newDecl[1]} instance declared at line ${li + 1}`,
        documentation: `Array-style value created with \`new ${newDecl[1]} ${newDecl[2]}: { ... }\`.`
      });
    }

    const importDecl = line.match(IMPORT_CAPTURE_RE);
    if (importDecl) {
      const modules = importDecl[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

      for (const moduleName of modules) {
        pushSymbol(symbols, seen, {
          label: moduleName,
          kind: vscode.CompletionItemKind.Module,
          detail: `Imported module at line ${li + 1}`,
          documentation: moduleName.startsWith('plugin:')
            ? `Plugin import.\n\nThis loads runtime functions from \`${moduleName}\`.`
            : `Module import.\n\nImported with \`${line}\`.`
        });
      }
    }
  }

  return symbols;
}

function pushSymbol(symbols, seen, symbol) {
  const key = `${symbol.kind}:${symbol.label.toLowerCase()}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  symbols.push(symbol);
}

function createSymbolHover(document, text) {
  const target = text.toLowerCase();
  const lines = document.getText().split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const raw = stripLineCommentPreserveQuotes(lines[li]);
    const line = raw.trim();
    if (!line) {
      continue;
    }

    const functionDecl = line.match(DEF_DECL_CAPTURE_RE);
    if (functionDecl && functionDecl[1].toLowerCase() === target) {
      return new vscode.Hover(new vscode.MarkdownString(
        `**Function \`${functionDecl[1]}\`**\n\nDeclared on line ${li + 1}.\n\nSignature source:\n\`${line}\``
      ));
    }

    const confDecl = line.match(CONF_DECL_CAPTURE_RE);
    if (confDecl && confDecl[1].toLowerCase() === target) {
      return new vscode.Hover(new vscode.MarkdownString(
        `**Config \`${confDecl[1]}\`**\n\nDeclared on line ${li + 1}.\n\nConfigs are dictionary-like values intended for import and composition with \`map(...)\`.`
      ));
    }

    const dictDecl = line.match(DICT_DECL_CAPTURE_RE);
    if (dictDecl && dictDecl[1].toLowerCase() === target) {
      return new vscode.Hover(new vscode.MarkdownString(
        `**Dictionary \`${dictDecl[1]}\`**\n\nDeclared on line ${li + 1}.`
      ));
    }

    const varDecl = line.match(VAR_DECL_CAPTURE_RE);
    if (varDecl && varDecl[2].toLowerCase() === target) {
      const typeName = varDecl[1] || 'inferred';
      return new vscode.Hover(new vscode.MarkdownString(
        `**Variable \`${varDecl[2]}\`**\n\nDeclared on line ${li + 1}.\n\nType: \`${typeName}\`\n\nInitializer:\n\`${line}\``
      ));
    }

    const newDecl = line.match(NEW_DECL_CAPTURE_RE);
    if (newDecl && newDecl[2].toLowerCase() === target) {
      return new vscode.Hover(new vscode.MarkdownString(
        `**${newDecl[1]} value \`${newDecl[2]}\`**\n\nDeclared on line ${li + 1} with array-style \`new\` syntax.`
      ));
    }
  }

  return null;
}

function collectMemberCompletions(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  const memberMatch = line.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*([A-Za-z_][A-Za-z0-9_]*)?$/);
  if (!memberMatch) {
    return null;
  }

  const ownerName = memberMatch[1].toLowerCase();
  const fieldMap = collectStructuredFields(document);
  const fields = fieldMap.get(ownerName);
  if (!fields || fields.length === 0) {
    return null;
  }

  return fields.map((field) => {
    const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
    item.detail = `${field.type} field on ${memberMatch[1]}`;
    item.documentation = new vscode.MarkdownString(
      `Field from \`${field.owner}\`.\n\nDeclared type: \`${field.type}\`${field.line ? `\n\nDeclared on line ${field.line}.` : ''}`
    );
    item.insertText = field.name;
    item.sortText = `0_${field.name}`;
    return item;
  });
}

function collectStructuredFields(document) {
  const fieldsByOwner = new Map();
  const lines = document.getText().split(/\r?\n/);
  const blockStack = [];
  const aliases = new Map();

  for (let li = 0; li < lines.length; li++) {
    const rawLine = stripLineCommentPreserveQuotes(lines[li]);
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const confDecl = line.match(CONF_DECL_CAPTURE_RE);
    if (confDecl) {
      blockStack.push({ owner: confDecl[1], braceDepth: 0 });
    } else {
      const dictDecl = line.match(DICT_DECL_CAPTURE_RE);
      if (dictDecl) {
        blockStack.push({ owner: dictDecl[1], braceDepth: 0 });
      }
    }

    const aliasMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*map\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/i);
    if (aliasMatch) {
      aliases.set(aliasMatch[1].toLowerCase(), aliasMatch[2].toLowerCase());
    }

    if (blockStack.length > 0) {
      const current = blockStack[blockStack.length - 1];
      const fieldMatch = line.match(/^\s*(int|flt|str|string|arr(?:\[[^\]]+\])?|dict|conf)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i);
      if (fieldMatch) {
        const ownerKey = current.owner.toLowerCase();
        if (!fieldsByOwner.has(ownerKey)) {
          fieldsByOwner.set(ownerKey, []);
        }

        fieldsByOwner.get(ownerKey).push({
          owner: current.owner,
          name: fieldMatch[2],
          type: fieldMatch[1],
          line: li + 1
        });
      }
    }

    const opens = countCharOutsideStrings(rawLine, '{');
    const closes = countCharOutsideStrings(rawLine, '}');
    if (blockStack.length > 0) {
      blockStack[blockStack.length - 1].braceDepth += opens;
      blockStack[blockStack.length - 1].braceDepth -= closes;
      if (blockStack[blockStack.length - 1].braceDepth <= 0 && closes > 0) {
        blockStack.pop();
      }
    }
  }

  for (const [alias, source] of aliases.entries()) {
    if (fieldsByOwner.has(source) && !fieldsByOwner.has(alias)) {
      fieldsByOwner.set(alias, fieldsByOwner.get(source));
    }
  }

  return fieldsByOwner;
}

function collectImportCompletions(document, position) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const importMatch = linePrefix.match(/^\s*(with|import)\s+(.+)$/i);
  if (!importMatch) {
    return null;
  }

  const spec = importMatch[2].trim();
  const isPluginImport = /^plugin:/i.test(spec);
  const suggestions = isPluginImport
    ? findAvailablePluginImports(document)
    : findAvailableModuleImports(document);

  if (suggestions.length === 0) {
    return null;
  }

  return suggestions.map((entry) => {
    const item = new vscode.CompletionItem(entry.label, entry.kind);
    item.detail = entry.detail;
    item.documentation = new vscode.MarkdownString(entry.documentation);
    item.insertText = entry.insertText || entry.label;
    item.sortText = `0_${entry.label}`;
    return item;
  });
}

function findAvailableModuleImports(document) {
  const roots = buildImportSearchRoots(document);
  const modules = new Map();

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.doe' && ext !== '.dough') {
        continue;
      }

      const moduleName = path.basename(entry.name, ext);
      if (moduleName.startsWith('.')) {
        continue;
      }

      const key = moduleName.toLowerCase();
      if (!modules.has(key)) {
        modules.set(key, {
          label: moduleName,
          kind: vscode.CompletionItemKind.Module,
          detail: `Module import from ${root}`,
          documentation: `Module file: \`${path.join(root, entry.name)}\``
        });
      }
    }
  }

  return Array.from(modules.values());
}

function findAvailablePluginImports(document) {
  const roots = buildPluginSearchRoots(document);
  const plugins = new Map();

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nestedDll = path.join(root, entry.name, `${entry.name}.dll`);
        if (fs.existsSync(nestedDll)) {
          const label = `plugin:${entry.name}`;
          plugins.set(label.toLowerCase(), {
            label,
            insertText: label,
            kind: vscode.CompletionItemKind.Module,
            detail: `Plugin import from ${path.join(root, entry.name)}`,
            documentation: `Plugin assembly: \`${nestedDll}\``
          });
        }
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.dll') {
        continue;
      }

      const pluginName = path.basename(entry.name, '.dll');
      const label = `plugin:${pluginName}`;
      if (!plugins.has(label.toLowerCase())) {
        plugins.set(label.toLowerCase(), {
          label,
          insertText: label,
          kind: vscode.CompletionItemKind.Module,
          detail: `Plugin import from ${root}`,
          documentation: `Plugin assembly: \`${path.join(root, entry.name)}\``
        });
      }
    }
  }

  return Array.from(plugins.values());
}

function buildImportSearchRoots(document) {
  const roots = new Set();
  const fileDir = path.dirname(document.uri.fsPath);
  const workspaceFolder = getOwningWorkspaceFolder(document.uri);
  const workspaceRoot = workspaceFolder && workspaceFolder.uri ? workspaceFolder.uri.fsPath : null;
  const projectRoot = findProjectRootFromProgram(document.uri.fsPath);

  addImportRootCandidate(roots, fileDir);
  addImportRootCandidate(roots, path.join(fileDir, 'lib'));
  addImportRootCandidate(roots, path.join(fileDir, 'libs'));
  addImportRootCandidate(roots, path.join(fileDir, 'library'));
  addImportRootCandidate(roots, path.join(fileDir, 'libraries'));

  for (const root of [workspaceRoot, projectRoot]) {
    if (!root) {
      continue;
    }

    addImportRootCandidate(roots, root);
    addImportRootCandidate(roots, path.join(root, 'lib'));
    addImportRootCandidate(roots, path.join(root, 'libs'));
    addImportRootCandidate(roots, path.join(root, 'library'));
    addImportRootCandidate(roots, path.join(root, 'libraries'));
  }

  return Array.from(roots);
}

function buildPluginSearchRoots(document) {
  const roots = new Set();
  const fileDir = path.dirname(document.uri.fsPath);
  const workspaceFolder = getOwningWorkspaceFolder(document.uri);
  const workspaceRoot = workspaceFolder && workspaceFolder.uri ? workspaceFolder.uri.fsPath : null;
  const projectRoot = findProjectRootFromProgram(document.uri.fsPath);

  for (const root of [fileDir, workspaceRoot, projectRoot]) {
    if (!root) {
      continue;
    }

    addImportRootCandidate(roots, path.join(root, 'plugins'));
    addImportRootCandidate(roots, path.join(root, 'plugin'));
  }

  return Array.from(roots);
}

function addImportRootCandidate(roots, candidate) {
  if (!candidate) {
    return;
  }

  roots.add(path.resolve(candidate));
}

function computeDiagnostics(document) {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const problems = [];

  runStructuralChecks(document, text, lines, problems);
  runLineGrammarChecks(document, lines, problems);

  return problems;
}

function runStructuralChecks(document, text, lines, problems) {
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stringStart = null;
  let blockCommentStart = null;
  const stack = [];

  let line = 0;
  let col = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '\n') {
      line++;
      col = 0;
      inLineComment = false;
      continue;
    }

    if (inLineComment) {
      col++;
      continue;
    }

    if (inBlockComment) {
      if (ch === ')' && next === '\\') {
        inBlockComment = false;
        i++;
        col += 2;
        continue;
      }

      col++;
      continue;
    }

    if (inString) {
      if (ch === '\\' && next) {
        i++;
        col += 2;
        continue;
      }

      if (ch === '"') {
        inString = false;
        col++;
        continue;
      }

      col++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      col += 2;
      continue;
    }

    if (ch === '/' && next === '(') {
      inBlockComment = true;
      blockCommentStart = { line, col };
      i++;
      col += 2;
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = { line, col };
      col++;
      continue;
    }

    if (OPENING.has(ch)) {
      stack.push({ ch, line, col });
      col++;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(CLOSING_TO_OPENING, ch)) {
      const expectedOpen = CLOSING_TO_OPENING[ch];
      const top = stack.pop();
      if (!top || top.ch !== expectedOpen) {
        problems.push(
          diagnostic(document, line, col, line, col + 1, `Unexpected '${ch}'.`, vscode.DiagnosticSeverity.Error)
        );
      }

      col++;
      continue;
    }

    if (ch === '@') {
      let j = i + 1;
      while (j < text.length && /[A-Za-z]/.test(text[j])) {
        j++;
      }

      const lit = text.slice(i + 1, j);
      if (!/^true$/i.test(lit) && !/^false$/i.test(lit)) {
        problems.push(
          diagnostic(
            document,
            line,
            col,
            line,
            col + Math.max(1, j - i),
            `Invalid bool literal '@${lit}'. Use @true or @false.`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      col += Math.max(1, j - i);
      i = j - 1;
      continue;
    }

    col++;
  }

  if (inString && stringStart) {
    const lastCol = lineLength(lines, stringStart.line);
    problems.push(
      diagnostic(
        document,
        stringStart.line,
        stringStart.col,
        stringStart.line,
        Math.max(stringStart.col + 1, lastCol),
        'Unterminated string literal.',
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  if (inBlockComment && blockCommentStart) {
    const lastCol = lineLength(lines, blockCommentStart.line);
    problems.push(
      diagnostic(
        document,
        blockCommentStart.line,
        blockCommentStart.col,
        blockCommentStart.line,
        Math.max(blockCommentStart.col + 2, lastCol),
        "Unterminated block comment. Expected ')\\'.",
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  for (const open of stack) {
    problems.push(
      diagnostic(
        document,
        open.line,
        open.col,
        open.line,
        open.col + 1,
        `Unclosed '${open.ch}'.`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
}

function runLineGrammarChecks(document, lines, problems) {
  const declaredPoints = new Map();
  const explicitPointCalls = new Set();
  const implicitPointCalls = new Set();
  const pointRefs = [];
  const declaredFunctions = new Map();
  const calledFunctions = new Set();
  const functionScope = createFunctionScopeIndex(lines);
  const loopScope = createLoopScopeIndex(lines);
  const pointScope = createPointScopeIndex(lines);

  for (let li = 0; li < lines.length; li++) {
    const original = lines[li];
    const line = stripLineCommentPreserveQuotes(original).trim();
    if (line.length === 0) {
      continue;
    }

    // NEW: Check for if without body (but not for inline actions)
    if (/^(if|unless)\s*\([^)]+\)\s*$/.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Missing body after if condition. Expected '{' or statement.",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    const pointDecl = line.match(POINT_DECL_RE);
    if (pointDecl) {
      if (declaredPoints.has(pointDecl[1].toLowerCase())) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            `Point '*${pointDecl[1]}' is declared more than once.`,
            vscode.DiagnosticSeverity.Warning
          )
        );
      }

      declaredPoints.set(pointDecl[1].toLowerCase(), { name: pointDecl[1], line: li });
    } else if (/^\s*\(\*/.test(line) && /\bawaitval\b/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Malformed point declaration. Use: (*Point:) awaitval(value;)",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/\bawaitval\s*\(/i.test(line) && !pointDecl && !LEGACY_POINT_CASE_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "awaitval must be used in a point declaration: (*Point:) awaitval(value;)",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    const legacyPoint = line.match(LEGACY_POINT_CASE_RE);
    if (legacyPoint) {
      if (declaredPoints.has(legacyPoint[1].toLowerCase())) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            `Point '*${legacyPoint[1]}' is declared more than once.`,
            vscode.DiagnosticSeverity.Warning
          )
        );
      }

      declaredPoints.set(legacyPoint[1].toLowerCase(), { name: legacyPoint[1], line: li });
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Legacy point-case syntax is deprecated. Prefer IfCase blocks.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^(if|unless|elif|ifcase)\b/i.test(line)) {
      if (!line.includes('(') || !line.includes(')')) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            "Conditional is missing '(' or ')'.",
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }

    const inlineAction = line.match(IF_HEADER_ACTION_RE);
    if (inlineAction) {
      const action = inlineAction[2].trim();
      const looksValidAction = /^(then|break|yield|yeild)\b/i.test(action) || /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(action);
      if (!looksValidAction) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            "Inline action after '::' should be Then, Break, yeild/yield, or a function call.",
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }

    if (/^as\b/i.test(line) && !AS_LOOP_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid loop syntax. Use: as(condition):",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^each\b/i.test(line) && !EACH_LOOP_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid each syntax. Use: each(item in iterable) do:",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^(yield|yeild)\b/i.test(line) && !YIELD_DISPATCH_RE.test(line) && !YIELD_CALL_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid yeild/yield syntax. Use: yield(value >> Point), yield value << Point, or with '*' point refs.",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^yeild\b/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[legacy] 'yeild' is accepted, but preferred spelling is 'yield'.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/\*this\b/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[preferred] Use 'this' without '*' (write 'this', not '*this').",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^return\b/i.test(line) && line.includes('>>') && !RETURN_POINT_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Malformed return dispatch. Use: return value >> this (or >> Point).",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^return\b/i.test(line) && !line.includes('>>') && !line.includes('<<')) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[preferred] Return dispatch style is: return value >> this",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^store\b/i.test(line) && !STORE_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid Store syntax. Use: Store(value Asa name >> *Point)",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^request\b/i.test(line) && !REQUEST_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid request syntax. Use: request(x << *Point.StoredName)",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/\bfuncs?\b/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[deprecated] 'Funcs' is Depracated in README and should not be used.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/\bloop\s*\(/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[legacy] loop(...) syntax is not fully supported; prefer as(...) or each(... in ...) do:",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    const cond = line.match(COND_RE);
    if (cond && BARE_ASSIGNMENT_RE.test(cond[2])) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          'Suspicious assignment in condition. Use == for comparison (or === for strict check).',
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^def\b/i.test(line) && !DEF_DECL_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          'Function declaration must include a valid name after def.',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    const functionDecl = line.match(DEF_DECL_CAPTURE_RE);
    if (functionDecl) {
      const lowerName = functionDecl[1].toLowerCase();
      if (declaredFunctions.has(lowerName)) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            `Function '${functionDecl[1]}' is declared more than once.`,
            vscode.DiagnosticSeverity.Warning
          )
        );
      }

      declaredFunctions.set(lowerName, { name: functionDecl[1], line: li });
    }

    if (DEF_DECL_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "[deprecated] 'def' is Depracated in Dough docs; keep only for backward compatibility.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^case\b/i.test(line) && !/:$/.test(line) && !line.includes('::')) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Case clause should end with ':'.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^(default|otherwise)\b/i.test(line) && !line.includes(':')) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Default/Otherwise clause should include ':'.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^(locked\s+)?dict\b/i.test(line)) {
      if (!line.includes(':')) {
        problems.push(
          diagnostic(
            document,
            li,
            0,
            li,
            original.length,
            "Dictionary declaration is missing ':'.",
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }

    if (/^conf\b/i.test(line) && !CONF_RE.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Invalid conf syntax. Use: conf name: followed by a block.",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/\breturn\b/i.test(line) && !functionScope.isInsideFunction(li)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          'return outside function block.',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^\s*break\b/i.test(line) && !loopScope.isInsideLoop(li)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          'break outside loop block.',
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/\bthis\b/i.test(line) && !pointScope.isInsidePoint(li)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "'this' point reference is only valid inside a point handler body.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    CALL_CAPTURE_RE.lastIndex = 0;
    let callMatch;
    while ((callMatch = CALL_CAPTURE_RE.exec(line)) !== null) {
      const callName = callMatch[1].toLowerCase();
      if (NON_FUNCTION_CALLS.has(callName)) {
        continue;
      }

      if (functionDecl && callName === functionDecl[1].toLowerCase()) {
        continue;
      }

      calledFunctions.add(callName);
    }

    collectPointCalls(line, li, explicitPointCalls, implicitPointCalls, pointRefs);
  }

  for (const name of implicitPointCalls) {
    if (declaredPoints.has(name)) {
      explicitPointCalls.add(name);
    }
  }

  for (const [lowerName, point] of declaredPoints.entries()) {
    if (explicitPointCalls.has(lowerName)) {
      continue;
    }

    problems.push(
      diagnostic(
        document,
        point.line,
        0,
        point.line,
        lines[point.line].length,
        `Point '*${point.name}' is declared but never called.`,
        vscode.DiagnosticSeverity.Warning
      )
    );
  }

  for (const ref of pointRefs) {
    if (declaredPoints.has(ref.name)) {
      continue;
    }

    problems.push(
      diagnostic(
        document,
        ref.line,
        ref.col,
        ref.line,
        ref.col + ref.length,
        `Point '*${ref.rawName}' is referenced but never declared.`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  for (const [lowerName, fn] of declaredFunctions.entries()) {
    if (lowerName === 'main' || calledFunctions.has(lowerName)) {
      continue;
    }

    problems.push(
      diagnostic(
        document,
        fn.line,
        0,
        fn.line,
        lines[fn.line].length,
        `Function '${fn.name}' is declared but never called.`,
        vscode.DiagnosticSeverity.Warning
      )
    );
  }
}

function collectPointCalls(line, lineIndex, explicitPointCalls, implicitPointCalls, pointRefs) {
  let m;

  const explicitRefs = [
    />>\s*\*([A-Za-z_][A-Za-z0-9_]*)/gi,
    /<<\s*\*([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\*([A-Za-z_][A-Za-z0-9_]*)\s*>>/gi,
    /\*([A-Za-z_][A-Za-z0-9_]*)\s*<</gi,
    /\b(?:yield|yeild)\s*\(\s*\*([A-Za-z_][A-Za-z0-9_]*)/gi
  ];

  for (const re of explicitRefs) {
    while ((m = re.exec(line)) !== null) {
      explicitPointCalls.add(m[1].toLowerCase());
      pointRefs.push({
        name: m[1].toLowerCase(),
        rawName: m[1],
        line: lineIndex,
        col: m.index,
        length: Math.max(2, m[1].length + 1)
      });
    }
  }

  const implicitRefs = [
    />>\s*([A-Za-z_][A-Za-z0-9_]*)/gi,
    /<<\s*([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\breturn\b[^\n]*>>\s*([A-Za-z_][A-Za-z0-9_]*)/gi
  ];

  for (const re of implicitRefs) {
    while ((m = re.exec(line)) !== null) {
      const pointName = m[1].toLowerCase();
      if (pointName !== 'this') {
        implicitPointCalls.add(pointName);
        pointRefs.push({
          name: pointName,
          rawName: m[1],
          line: lineIndex,
          col: m.index,
          length: Math.max(1, m[1].length)
        });
      }
    }
  }
}

function createFunctionScopeIndex(lines) {
  const functionLines = new Set();
  let braceDepth = 0;
  let pendingFunctionStart = false;
  const functionDepthMarkers = [];

  for (let li = 0; li < lines.length; li++) {
    const line = stripLineCommentPreserveQuotes(lines[li]);
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (/^def\s+[A-Za-z_][A-Za-z0-9_]*/i.test(trimmed)) {
      pendingFunctionStart = true;
    }

    const opens = countCharOutsideStrings(line, '{');
    const closes = countCharOutsideStrings(line, '}');

    for (let i = 0; i < opens; i++) {
      braceDepth++;
      if (pendingFunctionStart) {
        functionDepthMarkers.push(braceDepth);
        pendingFunctionStart = false;
      }
    }

    if (functionDepthMarkers.length > 0) {
      functionLines.add(li);
    }

    for (let i = 0; i < closes; i++) {
      if (functionDepthMarkers.length > 0 && braceDepth === functionDepthMarkers[functionDepthMarkers.length - 1]) {
        functionDepthMarkers.pop();
      }

      braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return {
    isInsideFunction(lineIndex) {
      return functionLines.has(lineIndex);
    }
  };
}

function createLoopScopeIndex(lines) {
  const loopLines = new Set();
  let braceDepth = 0;
  let pendingLoopStart = false;
  const loopDepthMarkers = [];

  for (let li = 0; li < lines.length; li++) {
    const line = stripLineCommentPreserveQuotes(lines[li]);
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (/^(as\s*\(|each\s*\()/i.test(trimmed)) {
      pendingLoopStart = true;
    }

    const opens = countCharOutsideStrings(line, '{');
    const closes = countCharOutsideStrings(line, '}');

    for (let i = 0; i < opens; i++) {
      braceDepth++;
      if (pendingLoopStart) {
        loopDepthMarkers.push(braceDepth);
        pendingLoopStart = false;
      }
    }

    if (loopDepthMarkers.length > 0) {
      loopLines.add(li);
    }

    for (let i = 0; i < closes; i++) {
      if (loopDepthMarkers.length > 0 && braceDepth === loopDepthMarkers[loopDepthMarkers.length - 1]) {
        loopDepthMarkers.pop();
      }

      braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return {
    isInsideLoop(lineIndex) {
      return loopLines.has(lineIndex);
    }
  };
}

function createPointScopeIndex(lines) {
  const pointLines = new Set();
  let braceDepth = 0;
  let pendingPointStart = false;
  const pointDepthMarkers = [];

  for (let li = 0; li < lines.length; li++) {
    const line = stripLineCommentPreserveQuotes(lines[li]);
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (POINT_DECL_RE.test(trimmed) || LEGACY_POINT_CASE_RE.test(trimmed)) {
      pendingPointStart = true;
    }

    const opens = countCharOutsideStrings(line, '{');
    const closes = countCharOutsideStrings(line, '}');

    for (let i = 0; i < opens; i++) {
      braceDepth++;
      if (pendingPointStart) {
        pointDepthMarkers.push(braceDepth);
        pendingPointStart = false;
      }
    }

    if (pointDepthMarkers.length > 0) {
      pointLines.add(li);
    }

    for (let i = 0; i < closes; i++) {
      if (pointDepthMarkers.length > 0 && braceDepth === pointDepthMarkers[pointDepthMarkers.length - 1]) {
        pointDepthMarkers.pop();
      }

      braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return {
    isInsidePoint(lineIndex) {
      return pointLines.has(lineIndex);
    }
  };
}

function countCharOutsideStrings(line, target) {
  let inString = false;
  let count = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }

    if (!inString && ch === target) {
      count++;
    }
  }

  return count;
}

function stripLineCommentPreserveQuotes(line) {
  let inString = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && line[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }

    if (!inString && ch === '/' && next === '/') {
      return line.slice(0, i);
    }
  }

  return line;
}

function lineLength(lines, index) {
  if (index < 0 || index >= lines.length) {
    return 0;
  }

  return lines[index].length;
}

function diagnostic(document, startLine, startCol, endLine, endCol, message, severity) {
  const range = new vscode.Range(
    new vscode.Position(startLine, startCol),
    new vscode.Position(endLine, Math.max(startCol + 1, endCol))
  );

  const d = new vscode.Diagnostic(range, message, severity);
  d.source = 'dough';
  return d;
}

module.exports = {
  activate,
  deactivate
};
