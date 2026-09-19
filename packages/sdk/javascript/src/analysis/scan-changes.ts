import ts from 'typescript';
import type { InstanceNodeInfo } from './inspect-nodes';
import type { SourceLocation } from './model';

export interface ScannedSend {
  infoType: string | null;
  rawInfoExpr: string;
  targetNodeId: string | null;
  rawTargetExpr: string;
  location: SourceLocation;
}

export interface ScannedRead {
  fieldName: string;
  location: SourceLocation;
}

export interface ScannedWrite {
  fieldName: string;
  location: SourceLocation;
}

export interface ScannedEffect {
  adapterOrName: string;
  location: SourceLocation;
}

export interface ScannedChangeBranch {
  nodeId: string;
  infoType: string;
  location: SourceLocation;
  reads: ScannedRead[];
  writes: ScannedWrite[];
  sends: ScannedSend[];
  effects: ScannedEffect[];
}

export function scanNodeChanges(nodeInfo: InstanceNodeInfo): ScannedChangeBranch[] {
  const branches: ScannedChangeBranch[] = [];
  const { sourceFile, filePath, nodeId, classDeclaration } = nodeInfo;

  // Resolve constructor parameter defaults and class properties
  const classFieldDefaults = new Map<string, string>();
  const classEffectAdapterIds = new Map<string, string>();
  function recordBoundStrings(path: string, value: ts.Expression): void {
    if (ts.isStringLiteral(value)) classFieldDefaults.set(path, value.text);
    else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
        if (key !== null) recordBoundStrings(`${path}.${key}`, property.initializer);
      }
    }
  }
  function boundPath(value: ts.Expression): string | null {
    if (value.kind === ts.SyntaxKind.ThisKeyword) return '';
    if (ts.isPropertyAccessExpression(value)) {
      const parent = boundPath(value.expression);
      return parent === null ? null : parent ? `${parent}.${value.name.text}` : value.name.text;
    }
    if (ts.isElementAccessExpression(value) && ts.isStringLiteral(value.argumentExpression)) {
      const parent = boundPath(value.expression);
      return parent === null ? null : parent ? `${parent}.${value.argumentExpression.text}` : value.argumentExpression.text;
    }
    return null;
  }

  function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  function stringLiteralValue(expression: ts.Expression): string | null {
    const current = unwrapExpression(expression);
    return ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)
      ? current.text
      : null;
  }

  function isInfoTypeExpression(expression: ts.Expression): boolean {
    const current = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(current)) {
      return ts.isIdentifier(current.expression)
        && current.expression.text === 'info'
        && current.name.text === 'type';
    }
    return ts.isElementAccessExpression(current)
      && ts.isIdentifier(current.expression)
      && current.expression.text === 'info'
      && current.argumentExpression !== undefined
      && stringLiteralValue(current.argumentExpression) === 'type';
  }

  function exactTypeComparison(
    expression: ts.Expression,
  ): { operator: 'equal' | 'not-equal'; infoType: string } | null {
    const current = unwrapExpression(expression);
    if (!ts.isBinaryExpression(current)) return null;
    const operator = current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      ? 'equal'
      : current.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        ? 'not-equal'
        : null;
    if (!operator) return null;
    if (isInfoTypeExpression(current.left)) {
      const infoType = stringLiteralValue(current.right);
      return infoType === null ? null : { operator, infoType };
    }
    if (isInfoTypeExpression(current.right)) {
      const infoType = stringLiteralValue(current.left);
      return infoType === null ? null : { operator, infoType };
    }
    return null;
  }

  function intersectTypes(left: Set<string>, right: Set<string>): Set<string> {
    return new Set([...left].filter((value) => right.has(value)));
  }

  function typesUnderConjunction(
    left: Set<string> | null,
    right: Set<string> | null,
  ): Set<string> | null {
    if (left === null) return right;
    if (right === null) return left;
    return intersectTypes(left, right);
  }

  function typesUnderAlternative(
    left: Set<string> | null,
    right: Set<string> | null,
  ): Set<string> | null {
    if (left === null || right === null) return null;
    return new Set([...left, ...right]);
  }

  function typesWhenTrue(expression: ts.Expression): Set<string> | null {
    const current = unwrapExpression(expression);
    const comparison = exactTypeComparison(current);
    if (comparison) {
      return comparison.operator === 'equal' ? new Set([comparison.infoType]) : null;
    }
    if (ts.isPrefixUnaryExpression(current)
      && current.operator === ts.SyntaxKind.ExclamationToken) {
      return typesWhenFalse(current.operand);
    }
    if (!ts.isBinaryExpression(current)) return null;
    if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return typesUnderConjunction(typesWhenTrue(current.left), typesWhenTrue(current.right));
    }
    if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return typesUnderAlternative(typesWhenTrue(current.left), typesWhenTrue(current.right));
    }
    return null;
  }

  function typesWhenFalse(expression: ts.Expression): Set<string> | null {
    const current = unwrapExpression(expression);
    const comparison = exactTypeComparison(current);
    if (comparison) {
      return comparison.operator === 'not-equal' ? new Set([comparison.infoType]) : null;
    }
    if (ts.isPrefixUnaryExpression(current)
      && current.operator === ts.SyntaxKind.ExclamationToken) {
      return typesWhenTrue(current.operand);
    }
    if (!ts.isBinaryExpression(current)) return null;
    if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return typesUnderConjunction(typesWhenFalse(current.left), typesWhenFalse(current.right));
    }
    if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return typesUnderAlternative(typesWhenFalse(current.left), typesWhenFalse(current.right));
    }
    return null;
  }

  function statementAlwaysExits(statement: ts.Statement): boolean {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (!ts.isBlock(statement) || statement.statements.length === 0) return false;
    return statementAlwaysExits(statement.statements[statement.statements.length - 1]);
  }
  for (const member of classDeclaration.members) {
    if (ts.isPropertyDeclaration(member) && member.initializer) {
      recordBoundStrings(member.name.getText(sourceFile), member.initializer);
      if (ts.isStringLiteral(member.initializer)) {
        classFieldDefaults.set(member.name.getText(sourceFile), member.initializer.text);
      } else if (ts.isObjectLiteralExpression(member.initializer)) {
        const idProperty = member.initializer.properties.find((property) => (
          ts.isPropertyAssignment(property)
          && ['id', "'id'", '"id"'].includes(property.name.getText(sourceFile))
          && ts.isStringLiteral(property.initializer)
        ));
        if (idProperty && ts.isPropertyAssignment(idProperty) && ts.isStringLiteral(idProperty.initializer)) {
          classEffectAdapterIds.set(member.name.getText(sourceFile), idProperty.initializer.text);
        }
      }
    }
    if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        if (param.initializer && ts.isStringLiteral(param.initializer)) {
          classFieldDefaults.set(param.name.getText(sourceFile), param.initializer.text);
        }
      }
      if (member.body) {
        ts.forEachChild(member.body, (stmt) => {
          if (
            ts.isExpressionStatement(stmt) &&
            ts.isBinaryExpression(stmt.expression) &&
            stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ) {
            const left = stmt.expression.left;
            const right = stmt.expression.right;
            if (
              ts.isPropertyAccessExpression(left) &&
              left.expression.kind === ts.SyntaxKind.ThisKeyword &&
              ts.isStringLiteral(right)
            ) {
              classFieldDefaults.set(left.name.text, right.text);
            }
          }
        });
      }
    }
  }

  function getLocation(node: ts.Node): SourceLocation {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    return {
      filePath,
      line: line + 1,
      column: character + 1,
    };
  }

  function extractBranchDetails(
    branchBody: ts.Node | ts.Node[],
    infoType: string,
    branchLocation: SourceLocation,
  ): ScannedChangeBranch {
    const branchNodes: ts.Node[] = Array.isArray(branchBody) ? branchBody : [branchBody];
    const reads: ScannedRead[] = [];
    const writes: ScannedWrite[] = [];
    const sends: ScannedSend[] = [];
    const effects: ScannedEffect[] = [];

    // Collect local bindings (e.g. const targetIds = ['node-gen-model'], for (const t of ['a', 'b']))
    const localStrings = new Map<string, string[]>();
    const localInfoTypes = new Map<string, string[]>();

    function resolveInfoTypes(expression: ts.Expression): string[] {
      const current = unwrapExpression(expression);
      if (ts.isObjectLiteralExpression(current)) {
        const typeProperty = current.properties.find((property) => (
          ts.isPropertyAssignment(property)
          && (
            property.name.getText(sourceFile) === 'type'
            || property.name.getText(sourceFile) === "'type'"
            || property.name.getText(sourceFile) === '"type"'
          )
          && ts.isStringLiteral(unwrapExpression(property.initializer))
        ));
        if (typeProperty && ts.isPropertyAssignment(typeProperty)) {
          const initializer = unwrapExpression(typeProperty.initializer);
          return ts.isStringLiteral(initializer) ? [initializer.text] : [];
        }
        return [];
      }
      if (ts.isConditionalExpression(current)) {
        return Array.from(new Set([
          ...resolveInfoTypes(current.whenTrue),
          ...resolveInfoTypes(current.whenFalse),
        ]));
      }
      if (ts.isIdentifier(current)) {
        if (current.text === 'info' && infoType !== '*') return [infoType];
        return localInfoTypes.get(current.text) ?? [];
      }
      return [];
    }

    function collectLocalBindings(n: ts.Node) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        if (ts.isStringLiteral(n.initializer)) {
          localStrings.set(n.name.text, [n.initializer.text]);
        } else if (ts.isArrayLiteralExpression(n.initializer)) {
          const items: string[] = [];
          for (const el of n.initializer.elements) {
            if (ts.isStringLiteral(el)) items.push(el.text);
          }
          if (items.length > 0) localStrings.set(n.name.text, items);
        } else if (ts.isConditionalExpression(n.initializer)) {
          const items: string[] = [];
          if (ts.isArrayLiteralExpression(n.initializer.whenFalse)) {
            for (const el of n.initializer.whenFalse.elements) {
              if (ts.isStringLiteral(el)) items.push(el.text);
            }
          }
          if (items.length > 0) localStrings.set(n.name.text, items);
        }
        const resolvedInfoTypes = resolveInfoTypes(n.initializer);
        if (resolvedInfoTypes.length > 0) {
          localInfoTypes.set(n.name.text, resolvedInfoTypes);
        }
      }
      if (ts.isForOfStatement(n)) {
        if (ts.isVariableDeclarationList(n.initializer)) {
          const varDecl = n.initializer.declarations[0];
          if (varDecl && ts.isIdentifier(varDecl.name)) {
            const loopVar = varDecl.name.text;
            if (ts.isArrayLiteralExpression(n.expression)) {
              const items: string[] = [];
              for (const el of n.expression.elements) {
                if (ts.isStringLiteral(el)) items.push(el.text);
              }
              if (items.length > 0) localStrings.set(loopVar, items);
            } else if (ts.isIdentifier(n.expression)) {
              const arrayItems = localStrings.get(n.expression.text);
              if (arrayItems) localStrings.set(loopVar, arrayItems);
            }
          }
        }
      }
      ts.forEachChild(n, collectLocalBindings);
    }
    branchNodes.forEach(collectLocalBindings);

    function visit(node: ts.Node) {
      // 1. ctx.read('field') or this.state.field
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'read' &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        reads.push({
          fieldName: node.arguments[0].text,
          location: getLocation(node),
        });
      } else if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.expression.name.text === 'state'
      ) {
        reads.push({
          fieldName: node.name.text,
          location: getLocation(node),
        });
      }

      // 2. ctx.write('field', ...)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'write' &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        writes.push({
          fieldName: node.arguments[0].text,
          location: getLocation(node),
        });
      }

      // 2b. ctx.patchState({ field: ... })
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'setState' || node.expression.name.text === 'patchState') &&
        node.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        for (const prop of node.arguments[0].properties) {
          if (ts.isPropertyAssignment(prop) && prop.name) {
            writes.push({
              fieldName: prop.name.getText(sourceFile),
              location: getLocation(prop),
            });
          }
        }
      }

      // 3. ctx.send(info, target)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'send' &&
        node.arguments.length > 0
      ) {
        const infoArg = node.arguments[0];
        const rawInfoExpr = infoArg.getText(sourceFile);
        const sendInfoTypes = resolveInfoTypes(infoArg);

        const targets: string[] = [];
        let rawTargetExpr = 'unresolved';
        if (node.arguments.length > 1) {
          const targetArg = node.arguments[1];
          rawTargetExpr = targetArg.getText(sourceFile);
          if (ts.isStringLiteral(targetArg)) {
            targets.push(targetArg.text);
          } else if (boundPath(targetArg) !== null) {
            const val = classFieldDefaults.get(boundPath(targetArg)!);
            if (val) targets.push(val);
          } else if (ts.isIdentifier(targetArg)) {
            const val = classFieldDefaults.get(targetArg.text);
            if (val) {
              targets.push(val);
            } else {
              const localVals = localStrings.get(targetArg.text);
              if (localVals && localVals.length > 0) {
                targets.push(...localVals);
              }
            }
          }
        }

        if (targets.length === 0) {
          for (const resolvedInfoType of sendInfoTypes.length > 0 ? sendInfoTypes : [null]) {
            sends.push({
              infoType: resolvedInfoType,
              rawInfoExpr,
              targetNodeId: null,
              rawTargetExpr,
              location: getLocation(node),
            });
          }
        } else {
          for (const targetNodeId of targets) {
            for (const resolvedInfoType of sendInfoTypes.length > 0 ? sendInfoTypes : [null]) {
              sends.push({
                infoType: resolvedInfoType,
                rawInfoExpr,
                targetNodeId,
                rawTargetExpr,
                location: getLocation(node),
              });
            }
          }
        }
      }

      // 4. ctx.effectAdapter(...)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'effect' || node.expression.name.text === 'effectAdapter')
      ) {
        let adapterName = 'AnonymousEffect';
        if (node.arguments.length > 1 && ts.isStringLiteral(node.arguments[1])) {
          adapterName = node.arguments[1].text;
        } else if (node.arguments.length > 0) {
          const adapterExpression = node.arguments[0];
          if (
            ts.isPropertyAccessExpression(adapterExpression)
            && adapterExpression.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            adapterName = classEffectAdapterIds.get(adapterExpression.name.text)
              ?? adapterExpression.getText(sourceFile);
          } else {
            adapterName = adapterExpression.getText(sourceFile);
          }
        }
        effects.push({
          adapterOrName: adapterName,
          location: getLocation(node),
        });
      }

      ts.forEachChild(node, visit);
    }

    branchNodes.forEach(visit);

    return {
      nodeId,
      infoType,
      location: branchLocation,
      reads,
      writes,
      sends,
      effects,
    };
  }

  // Scan methods in class
  for (const member of classDeclaration.members) {
    if (ts.isMethodDeclaration(member)) {
      const methodName = member.name.getText(sourceFile);
      if (methodName === 'change' && member.body) {
        const changeBody = member.body;
        const knownInfoTypes = new Set<string>();

        function rootTail(node: ts.Node): ts.Statement[] {
          const rootStatementIndex = changeBody.statements.findIndex((statement) => (
            statement.pos <= node.pos && statement.end >= node.end
          ));
          return rootStatementIndex >= 0
            ? [...changeBody.statements.slice(rootStatementIndex + 1)]
            : [];
        }

        function addTypedBranch(
          infoType: string,
          body: ts.Node | ts.Node[],
          location: SourceLocation,
        ): void {
          if (knownInfoTypes.has(infoType)) return;
          knownInfoTypes.add(infoType);
          branches.push(extractBranchDetails(body, infoType, location));
        }

        function collectTypedBranches(node: ts.Node): void {
          if (ts.isIfStatement(node)) {
            const tail = rootTail(node);
            for (const infoType of typesWhenTrue(node.expression) ?? []) {
              addTypedBranch(
                infoType,
                statementAlwaysExits(node.thenStatement)
                  ? node.thenStatement
                  : [node.thenStatement, ...tail],
                getLocation(node),
              );
            }
            const falseTypes = typesWhenFalse(node.expression);
            if (node.elseStatement) {
              for (const infoType of falseTypes ?? []) {
                addTypedBranch(
                  infoType,
                  statementAlwaysExits(node.elseStatement)
                    ? node.elseStatement
                    : [node.elseStatement, ...tail],
                  getLocation(node.elseStatement),
                );
              }
            } else if (statementAlwaysExits(node.thenStatement)) {
              for (const infoType of falseTypes ?? []) {
                addTypedBranch(infoType, tail, getLocation(node));
              }
            }
          } else if (ts.isSwitchStatement(node) && isInfoTypeExpression(node.expression)) {
            for (const clause of node.caseBlock.clauses) {
              if (!ts.isCaseClause(clause)) continue;
              const infoType = stringLiteralValue(clause.expression);
              if (infoType !== null) addTypedBranch(infoType, clause, getLocation(clause));
            }
          }
          ts.forEachChild(node, collectTypedBranches);
        }
        collectTypedBranches(changeBody);

        if (knownInfoTypes.size === 0) {
          // General change method handling all Info types
          branches.push(
            extractBranchDetails(member.body, '*', getLocation(member)),
          );
        }
      }
    }
  }

  return branches;
}
