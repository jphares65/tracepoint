#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPROVED_ALARMS, STACK_NAME, assertApprovedChangeSet, assertPatchIsExact, buildPatchedWorkerTemplate } from './staging-ses-worker-alarm-patch-core.mjs';

const region = 'us-east-1';
const account = '559054714699';
const profile = process.env.AWS_PROFILE || 'tracepoint-staging';
const execute = process.argv.includes('--execute');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const changeSetName = `tracepoint-staging-ses-worker-alarm-policy-${stamp}`;
const work = mkdtempSync(join(tmpdir(), 'tracepoint-ses-worker-alarm-policy-'));

function aws(...args) {
  try {
    return JSON.parse(execFileSync('aws', [...args, '--profile', profile, '--region', region, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error(`AWS ${args.slice(0, 2).join(' ')} failed`);
  }
}

function stackParameters(stack) {
  return (stack.Parameters ?? []).flatMap((parameter) => parameter.ParameterKey ? [`ParameterKey=${parameter.ParameterKey},UsePreviousValue=true`] : []);
}

try {
  const identity = aws('sts', 'get-caller-identity');
  if (identity.Account !== account) throw new Error('staging account boundary failed');
  const original = aws('cloudformation', 'get-template', '--stack-name', STACK_NAME, '--template-stage', 'Original').TemplateBody;
  const before = typeof original === 'string' ? JSON.parse(original) : original;
  const patched = buildPatchedWorkerTemplate(before);
  assertPatchIsExact(before, patched);
  const stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK_NAME).Stacks?.[0];
  if (stack?.StackStatus !== 'UPDATE_COMPLETE') throw new Error('worker stack must be UPDATE_COMPLETE before patching');
  const templatePath = join(work, 'patched-template.json');
  writeFileSync(templatePath, `${JSON.stringify(patched)}\n`, { encoding: 'utf8', mode: 0o600 });
  aws('cloudformation', 'validate-template', '--template-body', `file://${templatePath}`);
  const parameters = stackParameters(stack);
  aws('cloudformation', 'create-change-set', '--stack-name', STACK_NAME, '--change-set-name', changeSetName, '--change-set-type', 'UPDATE', '--template-body', `file://${templatePath}`, '--capabilities', 'CAPABILITY_NAMED_IAM', ...(parameters.length ? ['--parameters', ...parameters] : []));
  execFileSync('aws', ['cloudformation', 'wait', 'change-set-create-complete', '--stack-name', STACK_NAME, '--change-set-name', changeSetName, '--profile', profile, '--region', region], { stdio: 'ignore' });
  const changeSet = aws('cloudformation', 'describe-change-set', '--stack-name', STACK_NAME, '--change-set-name', changeSetName);
  assertApprovedChangeSet(changeSet);
  const changedTemplate = aws('cloudformation', 'get-template', '--stack-name', STACK_NAME, '--change-set-name', changeSetName).TemplateBody;
  assertPatchIsExact(before, typeof changedTemplate === 'string' ? JSON.parse(changedTemplate) : changedTemplate);
  if (!execute) {
    aws('cloudformation', 'delete-change-set', '--stack-name', STACK_NAME, '--change-set-name', changeSetName);
    console.log(JSON.stringify({ mode: 'dry-run', stack: STACK_NAME, changes: Object.keys(APPROVED_ALARMS), changeSetDeleted: true }));
  } else {
    aws('cloudformation', 'execute-change-set', '--stack-name', STACK_NAME, '--change-set-name', changeSetName);
    execFileSync('aws', ['cloudformation', 'wait', 'stack-update-complete', '--stack-name', STACK_NAME, '--profile', profile, '--region', region], { stdio: 'ignore' });
    const updated = aws('cloudformation', 'describe-stacks', '--stack-name', STACK_NAME).Stacks?.[0];
    if (updated?.StackStatus !== 'UPDATE_COMPLETE') throw new Error('worker stack update did not complete');
    console.log(JSON.stringify({ mode: 'execute', stack: STACK_NAME, changes: Object.keys(APPROVED_ALARMS), stackStatus: updated.StackStatus }));
  }
} catch (error) {
  try { aws('cloudformation', 'delete-change-set', '--stack-name', STACK_NAME, '--change-set-name', changeSetName); } catch { /* no created change set to remove */ }
  console.error(`SES worker alarm-policy patch rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
