const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const OPENING = new Set(['(', '[', '{']);
const CLOSING_TO_OPENING = {
  ')': '(',
  ']': '[',
  '}': '{'
};

const POINT_DECL_RE = /^\s*\(\*([A-Za-z_][A-Za-z0-9_]*)\:?\)\s*awaitval\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)/i;
const LEGACY_POINT_CASE_RE = /^\s*\*([A-Za-z_][A-Za-z0-9_]*)\s+ifcase\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)\s*$/i;
const CONF_RE = /^\s*conf\s+[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+;?\s*$/i;
const AS_LOOP_RE = /^\s*as\s*\(\s*.+\s*\)\s*:\s*$/i;
const EACH_LOOP_RE = /^\s*each\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+in\s+.+\)\s*do\s*:\s*$/i;
const YIELD_DISPATCH_RE = /^\s*(?:yield|yeild)\s+.+\s*>>\s*\*[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*;?\s*$/i;
const YIELD_CALL_RE = /^\s*(?:yield|yeild)\s*\(\s*.+\s*>>\s*\*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*;?\s*$/i;
const RETURN_POINT_RE = /^\s*return\b.+>>\s*\(?\s*(?:\*[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|this)\s*\)?\s*;?\s*$/i;
const STORE_RE = /^\s*store\s*\(\s*.+\s+asa\s+[A-Za-z_][A-Za-z0-9_]*\s*>>\s*\*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*;?\s*$/i;
const REQUEST_RE = /^\s*request\s*\(\s*.+\s*<<\s*\*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*;?\s*$/i;
const DEF_DECL_RE = /^def\s+[A-Za-z_][A-Za-z0-9_]*/i;
const DEF_DECL_CAPTURE_RE = /^def\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const IF_HEADER_ACTION_RE = /^(if|elif|else|otherwise)\b.*::\s*(.+)$/i;
const COND_RE = /^(if|elif)\s*\((.*)\)/i;
const BARE_ASSIGNMENT_RE = /(^|[^=!<>])=($|[^=>])/;
const CALL_CAPTURE_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const NON_FUNCTION_CALLS = new Set([
  'if', 'elif', 'ifcase', 'as', 'each', 'awaitval', 'store', 'request',
  'yield', 'yeild', 'return', 'print', 'input', 'readln', 'max', 'min',
  'exit', 'conf', 'debug', 'breakpoint'
]);

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('dough-syntax');
  context.subscriptions.push(diagnostics);

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

  // Prefer globally installed runtime first so independent files run without project setup.
  if (looksRunnableCommand('dough')) {
    return 'dough';
  }

  const root = folder && folder.uri
    ? folder.uri.fsPath
    : findProjectRootFromProgram(programPath);

  if (root) {
    const projectPath = path.join(root, 'Other_Bullshit', 'Doe-Language.csproj');
    if (fs.existsSync(projectPath)) {
      return `dotnet run --project "${projectPath}" --`;
    }
  }

  return 'dough';
}

function looksRunnableCommand(command) {
  // Lightweight heuristic for common extension host environments.
  return command && command.length > 0;
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

    if (/^(if|elif|ifcase)\b/i.test(line)) {
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
          "Invalid yeild/yield syntax. Use: yeild(value >> *Point) or yeild value >> *Point as alias",
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    if (/^yield\b/i.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "README spelling uses 'yeild'. 'yield' still works but is considered legacy style.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    if (/^(yield|yeild)\b/i.test(line) && />>/.test(line) && !/\*\s*[A-Za-z_][A-Za-z0-9_]*/.test(line)) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Point dispatch after yeild should use '*PointName'.",
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
          "Malformed return dispatch. Use: return value >> *Point (or >> this).",
          vscode.DiagnosticSeverity.Error
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
          "'Funcs' is Depracated in README and should not be used.",
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
          "loop(...) syntax is not fully supported yet; prefer as(...) or each(... in ...) do: loops.",
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
          'Suspicious assignment in condition. Use == for comparison.',
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
          "'def' is Depracated in Dough docs; keep only for backward compatibility.",
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

    if (/^default\b/i.test(line) && !line.includes(':')) {
      problems.push(
        diagnostic(
          document,
          li,
          0,
          li,
          original.length,
          "Default clause should include ':'.",
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
          "Invalid conf syntax. Use: conf target.property = value",
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
