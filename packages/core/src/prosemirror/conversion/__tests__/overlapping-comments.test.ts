import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../schema';
import type { Document, Paragraph, Run } from '../../../types/document';
import { extractTrackedChanges } from '../../utils/extractTrackedChanges';
import { fromProseDoc } from '../fromProseDoc';
import { toProseDoc } from '../toProseDoc';

function commentIds(node: PMNode): number[] {
  return node.marks
    .filter((mark) => mark.type.name === 'comment')
    .map((mark) => mark.attrs.commentId as number)
    .sort((a, b) => a - b);
}

function textRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] };
}

describe('overlapping comments', () => {
  test('a second comment on commented text keeps the first', () => {
    const first = schema.marks.comment.create({ commentId: 1 });
    const second = schema.marks.comment.create({ commentId: 2 });
    const paragraph = schema.nodes.paragraph.create(null, [schema.text('Limitation', [first])]);
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [paragraph]) });

    const next = state.apply(state.tr.addMark(1, 11, second));

    expect(commentIds(next.doc.firstChild!.firstChild!)).toEqual([1, 2]);
  });

  test('overlapping comment ranges keep every id and round-trip as two ranges', () => {
    // "Limitation of" is comment 1, "of Liability" is comment 2
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        { type: 'commentRangeStart', id: 1 },
        textRun('Limitation '),
        { type: 'commentRangeStart', id: 2 },
        textRun('of'),
        { type: 'commentRangeEnd', id: 1 },
        textRun(' Liability'),
        { type: 'commentRangeEnd', id: 2 },
      ],
    };
    const input: Document = { package: { document: { content: [paragraph] } } };

    const pmDoc = toProseDoc(input);
    const nodes: PMNode[] = [];
    pmDoc.firstChild!.forEach((node) => nodes.push(node));

    expect(nodes.map((node) => node.text)).toEqual(['Limitation ', 'of', ' Liability']);
    expect(nodes.map(commentIds)).toEqual([[1], [1, 2], [2]]);

    const roundTripped = fromProseDoc(pmDoc, input);
    const outParagraph = roundTripped.package.document.content[0] as Paragraph;
    const markers = outParagraph.content
      .filter((item) => item.type === 'commentRangeStart' || item.type === 'commentRangeEnd')
      .map((item) => `${item.type}:${(item as { id: number }).id}`);

    expect(markers).toEqual([
      'commentRangeStart:1',
      'commentRangeStart:2',
      'commentRangeEnd:1',
      'commentRangeEnd:2',
    ]);
  });

  test('every comment on a tracked change alone is threaded under it', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 7,
      author: 'Al',
      date: '2026-01-01T00:00:00Z',
    });
    const comments = [1, 2, 3].map((commentId) => schema.marks.comment.create({ commentId }));

    // Comments 1 and 2 cover only the insertion; comment 3 runs on into plain text
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text('and venue', [insertion, ...comments]),
      schema.text(' apply', [comments[2]]),
    ]);
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [paragraph]) });

    const { commentToRevision } = extractTrackedChanges(state);

    expect([...commentToRevision].sort(([a], [b]) => a - b)).toEqual([
      [1, 7],
      [2, 7],
    ]);
  });
});
