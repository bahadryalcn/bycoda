import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6');
const storageKeys = new Set(['bycoda.groupLock','bycoda.groupLock.unlocked','bycoda.groupLock.hiddenGroups.v1','bycoda.projectGroups','bycoda.projectGroupAssignments','bycoda.recentProjects','bycoda.archivedProjects']);
const guarded = new Set(['saveProjectGroups','saveProjectGroupAssignments','setProjectGroupAssignment','changeProjectGroupMembers','deleteProjectGroup','assignProjectsToNamedGroup','linkProjectGroup','unlinkProjectGroup','rememberImportedProjects','forgetProject','archiveProject','replaceProjectPath','removeProjectGroupAssignment','rebaseProjectGroupAssignment','applyRemoteLockRecord','applyRemoteProjectRecords','captureLocalProjectChanges','applyRemoteGroupRecords','captureLocalGroupChanges','applyRemoteLockRecords','rebaseProjectData','updateProjectGroup','captureAssignments','carryAssignments','makeGroupLockableNow','clearPassword','hideGroupNow','restoreHiddenGroupNow']);
function collect(root, directory, result) {
 for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
  const absolute=path.join(directory,entry.name);
  if(entry.isDirectory()) collect(root,absolute,result);
  else if(/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)) result.push(path.relative(root,absolute).replaceAll('\\','/'));
 }
}
function owner(node) {
 for(let current=node.parent;current;current=current.parent) {
  if ((ts.isFunctionDeclaration(current)||ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
  if ((ts.isArrowFunction(current)||ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) return current.parent.name.text;
 }
 return '<module>';
}
function fenced(node) {
 for(let current=node.parent;current;current=current.parent) {
  if (ts.isCallExpression(current)) {
   const expr=current.expression;
   if ((ts.isIdentifier(expr) && ['setTimeout','setInterval','queueMicrotask','requestAnimationFrame'].includes(expr.text)) ||
       (ts.isPropertyAccessExpression(expr) && ['then','catch','finally'].includes(expr.name.text))) return false;
  }
  if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression) || current.expression.text !== 'withRoomPrivacyMutation') continue;
  const callback=current.arguments[0];
  if (callback && (ts.isArrowFunction(callback)||ts.isFunctionExpression(callback)) && node.pos>=callback.pos && node.end<=callback.end) return true;
 }
 return false;
}
export function findPrivacyWriterCalls(root, files) {
 const input=files ?? (()=>{const result=[];const sourceRoot=path.join(root,'src');if(fs.existsSync(sourceRoot)) collect(root,sourceRoot,result);return result;})();
 const findings=[];
 for(const file of input) {
  if (!/^src\/.*\.tsx?$/.test(file) || /\.(test|spec|d)\.tsx?$/.test(file)) continue;
  const absolute=path.join(root,file); if(!fs.existsSync(absolute)) continue;
  const text=fs.readFileSync(absolute,'utf8');
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const aliases=new Map();
  const namespaceImports=new Set();
  const constants=new Map();
  for(const statement of source.statements) {
   if(ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) namespaceImports.add(statement.importClause.namedBindings.name.text);
   if(ts.isVariableStatement(statement)) for(const declaration of statement.declarationList.declarations) {
    if(ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) constants.set(declaration.name.text,declaration.initializer.text);
   }
  }
  for(const statement of source.statements) if(ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
   for(const element of statement.importClause.namedBindings.elements) {
    const original=element.propertyName?.text ?? element.name.text;
    if(guarded.has(original)) aliases.set(element.name.text,original);
   }
  }
  const visit=(node)=>{
   if(ts.isCallExpression(node)) {
    const expression=ts.isNonNullExpression(node.expression) ? node.expression.expression : node.expression;
    let name;
    if(ts.isIdentifier(expression)) name=aliases.get(expression.text) ?? expression.text;
    else if(ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const base=expression.expression.text;
      if(namespaceImports.has(base) && guarded.has(expression.name.text)) name=expression.name.text;
      if(base==='localStorage' && ['setItem','removeItem','clear'].includes(expression.name.text)) {
        const arg=node.arguments[0];
        const key=arg && (ts.isStringLiteral(arg) ? arg.text : ts.isIdentifier(arg) ? constants.get(arg.text) : undefined);
        if(expression.name.text==='clear' || storageKeys.has(key)) name=`localStorage.${expression.name.text}`;
      }
    }
    if((guarded.has(name) || name?.startsWith('localStorage.') || (file === 'src/features/projects/model/projectOrganizationControl.ts' && name === 'save')) && !fenced(node)) {
     const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
     const text=node.getText(source).replace(/\s+/g,' ');
     const key=[file,owner(node),name,createHash('sha256').update(text).digest('hex')].join('|');
     findings.push({file,owner:owner(node),name,line,text,key});
    }
   }
   ts.forEachChild(node,visit);
  }; visit(source);
 }
 return findings;
}
/** Existing delegates are reviewed by owner + exact AST call. New raw calls must be fenced. */
export function checkPrivacyWriterCalls({ root, files } = {}) {
 const reviewed=JSON.parse(fs.readFileSync(path.join(root,'scripts/checks/privacy-writer-exceptions.json'),'utf8'));
 if(reviewed.version!==1 || !Array.isArray(reviewed.exceptions)) throw new Error('Invalid privacy writer exceptions');
 const allowances=new Map();
 for(const item of reviewed.exceptions) {
  const key=[item.file,item.owner,item.writer,createHash('sha256').update(item.expression).digest('hex')].join('|');
  if(!Number.isSafeInteger(item.count)||item.count<1||allowances.has(key)) throw new Error('Invalid privacy writer exception');
  allowances.set(key,item.count);
 }
 return findPrivacyWriterCalls(root,files).filter(item=>{
  const remaining=allowances.get(item.key) ?? 0;
  if(remaining>0){allowances.set(item.key,remaining-1);return false;}
  return true;
 });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const findings=checkPrivacyWriterCalls({root:process.cwd()});
 if(findings.length){ for(const item of findings) console.error(`${item.file}:${item.line} ${item.name} must run inside withRoomPrivacyMutation`); process.exitCode=1; }
 else console.log('Privacy writer calls: no new unfenced calls.');
}
