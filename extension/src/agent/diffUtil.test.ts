/**
 * Property-based tests for diffUtil.ts
 *
 * Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
 *
 * Uses fast-check to verify that `computeDiff` behaves correctly across all
 * possible (original, proposed) input pairs.
 *
 * Validates: Requirements 5.1, 5.5, 5.6
 */

import * as fc from 'fast-check';
import * as assert from 'assert';
import { computeDiff } from './diffUtil';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the string looks like a unified diff patch. */
function looksLikePatch(s: string): boolean {
    const first = s.trimStart().slice(0, 3);
    return first === '---' || first === '@@ ';
}

/** Parse a unified diff string and return its hunk lines (those starting with @@ ). */
function parseHunkHeaders(diff: string): string[] {
    return diff.split('\n').filter((l) => l.startsWith('@@'));
}

// ---------------------------------------------------------------------------
// Property 8 — Full-File Replacement Always Shows Diff
//
// For any (original, proposed) pair where the strings differ and proposed is
// NOT already a unified diff patch, computeDiff MUST return a non-empty string
// that contains unified diff markers.
//
// Validates: Requirements 5.5, 5.6
// ---------------------------------------------------------------------------

describe('computeDiff — Property 8: full-file replacement always shows diff', function () {
    // Allow more time for PBT runs.
    this.timeout(30_000);

    it('returns non-empty diff for any differing (original, proposed) pair', () => {
        // Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
        fc.assert(
            fc.property(
                fc.string(), // arbitrary original content
                fc.string(), // arbitrary proposed content
                (original, proposed) => {
                    // Skip the pass-through case — that is tested separately.
                    if (looksLikePatch(proposed)) { return; }
                    if (original === proposed) { return; }

                    const diff = computeDiff(original, proposed);

                    // Must be non-empty when content differs.
                    assert.ok(
                        diff.length > 0,
                        `Expected non-empty diff but got empty string for:\n` +
                        `  original=${JSON.stringify(original)}\n` +
                        `  proposed=${JSON.stringify(proposed)}`
                    );
                }
            ),
            { numRuns: 500 }
        );
    });

    it('diff output contains unified diff markers when content differs', () => {
        // Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
        fc.assert(
            fc.property(
                fc.string(),
                fc.string(),
                (original, proposed) => {
                    if (looksLikePatch(proposed)) { return; }
                    if (original === proposed) { return; }

                    const diff = computeDiff(original, proposed);

                    // Must contain the standard file-header lines.
                    assert.ok(
                        diff.includes('--- original'),
                        `Diff missing '--- original' header.\ndiff=${JSON.stringify(diff)}`
                    );
                    assert.ok(
                        diff.includes('+++ proposed'),
                        `Diff missing '+++ proposed' header.\ndiff=${JSON.stringify(diff)}`
                    );

                    // Must contain at least one hunk marker.
                    const hunks = parseHunkHeaders(diff);
                    assert.ok(
                        hunks.length > 0,
                        `Diff has no @@ hunk markers.\ndiff=${JSON.stringify(diff)}`
                    );
                }
            ),
            { numRuns: 500 }
        );
    });

    it('returns empty string when original and proposed are identical', () => {
        // Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
        fc.assert(
            fc.property(
                fc.string(),
                (content) => {
                    if (looksLikePatch(content)) { return; }
                    const diff = computeDiff(content, content);
                    assert.strictEqual(
                        diff,
                        '',
                        `Expected empty diff for identical inputs but got: ${JSON.stringify(diff)}`
                    );
                }
            ),
            { numRuns: 200 }
        );
    });

    it('passes through proposed content that is already a unified diff', () => {
        // Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
        const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n`;
        const result = computeDiff('anything', patch);
        assert.strictEqual(result, patch, 'Pass-through should return proposed unchanged');
    });

    it('passes through content starting with @@ hunk marker', () => {
        // Feature: kurdbox-agent, Property 8: full-file replacement always shows diff
        const patch = `@@ -1,3 +1,3 @@\n context\n-removed\n+added\n context`;
        const result = computeDiff('some original', patch);
        assert.strictEqual(result, patch, 'Pass-through should return proposed unchanged');
    });
});

// ---------------------------------------------------------------------------
// Unit tests for specific behaviours
// ---------------------------------------------------------------------------

describe('computeDiff — unit tests', function () {
    it('produces correct diff for single-line change', () => {
        const original = 'line1\nold line\nline3\n';
        const proposed = 'line1\nnew line\nline3\n';
        const diff = computeDiff(original, proposed);

        assert.ok(diff.includes('-old line'), 'Should contain deletion');
        assert.ok(diff.includes('+new line'), 'Should contain insertion');
        assert.ok(diff.includes(' line1'),    'Should include context before');
        assert.ok(diff.includes(' line3'),    'Should include context after');
    });

    it('produces correct diff for appended lines', () => {
        const original = 'a\nb\nc\n';
        const proposed = 'a\nb\nc\nd\ne\n';
        const diff = computeDiff(original, proposed);

        assert.ok(diff.includes('+d'), 'Should show added line d');
        assert.ok(diff.includes('+e'), 'Should show added line e');
    });

    it('produces correct diff for removed lines', () => {
        const original = 'a\nb\nc\nd\n';
        const proposed = 'a\nd\n';
        const diff = computeDiff(original, proposed);

        assert.ok(diff.includes('-b'), 'Should show removed line b');
        assert.ok(diff.includes('-c'), 'Should show removed line c');
    });

    it('handles empty original (new file)', () => {
        const diff = computeDiff('', 'hello\nworld\n');
        assert.ok(diff.length > 0, 'Non-empty diff expected for empty original');
        assert.ok(diff.includes('+hello'), 'Should show inserted lines');
    });

    it('handles empty proposed (file cleared)', () => {
        const diff = computeDiff('hello\nworld\n', '');
        assert.ok(diff.length > 0, 'Non-empty diff expected when proposed is empty');
        assert.ok(diff.includes('-hello'), 'Should show deleted lines');
    });

    it('context lines do not exceed 3 around a single change', () => {
        // Build a file with many lines; change one in the middle.
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
        const original = lines.join('\n');
        lines[10] = 'changed';
        const proposed = lines.join('\n');

        const diff = computeDiff(original, proposed);
        const hunkMatch = diff.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        assert.ok(hunkMatch, 'Diff should have a hunk header');

        // The hunk should cover the changed line ± 3 context lines.
        const hunkLines = diff.split('\n').filter((l) => l.startsWith(' ') || l.startsWith('-') || l.startsWith('+'));
        const contextCount = hunkLines.filter((l) => l.startsWith(' ')).length;
        assert.ok(contextCount <= 6, `Expected ≤6 context lines, got ${contextCount}`);
    });
});
