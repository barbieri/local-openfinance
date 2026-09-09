import { describe, expect, it } from 'vitest';
import {
  buildAnnotationHierarchyPathIndex,
  resolveAnnotationHierarchyPath,
} from '../src/db/annotation-hierarchy-path.js';

type TestNode = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly metadata: string;
};

describe('annotation hierarchy paths', () => {
  it('resolves paths for nodes with fields beyond the canonical contract', () => {
    const nodes: TestNode[] = [
      { id: 'child', name: 'Filho', parentId: 'parent', metadata: 'child' },
      { id: 'parent', name: 'Pai', parentId: null, metadata: 'parent' },
    ];

    expect(buildAnnotationHierarchyPathIndex(nodes)).toEqual(
      new Map([
        ['child', 'Pai > Filho'],
        ['parent', 'Pai'],
      ]),
    );
  });

  it('stops at a cycle and falls back to the available branch when a parent is missing', () => {
    const first: TestNode = {
      id: 'first',
      name: 'Primeiro',
      parentId: 'second',
      metadata: 'first',
    };
    const second: TestNode = {
      id: 'second',
      name: 'Segundo',
      parentId: 'first',
      metadata: 'second',
    };
    const orphan: TestNode = {
      id: 'orphan',
      name: 'Órfã',
      parentId: 'missing',
      metadata: 'orphan',
    };

    const byId = new Map([
      [first.id, first],
      [second.id, second],
      [orphan.id, orphan],
    ]);

    expect(resolveAnnotationHierarchyPath(first, byId)).toBe('Segundo > Primeiro');
    expect(resolveAnnotationHierarchyPath(orphan, byId)).toBe('Órfã');
  });
});
