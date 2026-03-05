const vscode = require('vscode');

const OPENING = new Set(['(', '[', '{']);
const CLOSING_TO_OPENING = {
  ')': '(',
  ']': '[',
  '}': '{'
};

const POINT_DECL_RE = /^\s*\(\*([A-Za-z_][A-Za-z0-9_]*)\:?\)\s*awaitval\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)/i;
const LEGACY_POINT_CASE_RE = /^\s*\*([A-Za-z_][A-Za-z0-9_]*)\s+ifcase\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*\)\s*$/i;
const CONF_RE = /^\s*conf\s+[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+;?\s*$/i;

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('dough-syntax');
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand('dough.runCurrentFile', () => runOrDebugCurrentFile(false)),
    vscode.commands.registerCommand('dough.debugCurrentFile', () => runOrDebugCurrentFile(true))
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

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Open the Dough workspace folder before running.');
    return;
  }

  const root = folders[0].uri.fsPath;
  const project = `${root}\\Other_Bullshit\\Doe-Language.csproj`;
  const file = doc.fileName;
  const flags = debug ? '--debug' : '';
  const command = `dotnet run --project "${project}" -- ${flags} "${file}"`.replace(/\s+/g, ' ').trim();

  const terminalName = debug ? 'Dough Debugger' : 'Dough Runner';
  const terminal = vscode.window.createTerminal({ name: terminalName, cwd: root });
  terminal.show(true);
  terminal.sendText(command);
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

  for (let li = 0; li < lines.length; li++) {
    const original = lines[li];
    const line = stripLineCommentPreserveQuotes(original).trim();
    if (line.length === 0) {
      continue;
    }

    const pointDecl = line.match(POINT_DECL_RE);
    if (pointDecl) {
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

    const legacyPoint = line.match(LEGACY_POINT_CASE_RE);
    if (legacyPoint) {
      declaredPoints.set(legacyPoint[1].toLowerCase(), { name: legacyPoint[1], line: li });
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

    if (/^def\b/i.test(line) && !/^def\s+[A-Za-z_][A-Za-z0-9_]*/i.test(line)) {
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

    collectPointCalls(line, explicitPointCalls, implicitPointCalls);
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
}

function collectPointCalls(line, explicitPointCalls, implicitPointCalls) {
  let m;

  const explicitRefs = [
    />>\s*\*([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\*([A-Za-z_][A-Za-z0-9_]*)\s*<</gi,
    /\b(?:yield|yeild)\s*\(\s*\*([A-Za-z_][A-Za-z0-9_]*)/gi
  ];

  for (const re of explicitRefs) {
    while ((m = re.exec(line)) !== null) {
      explicitPointCalls.add(m[1].toLowerCase());
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
      }
    }
  }
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
