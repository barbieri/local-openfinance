/** Searchable peer identity such as `cpf:39053344705` or `cnpj:11222333000181`. */
export type PeerDocumentKeys = {
  readonly payerDocumentKey: string | null;
  readonly receiverDocumentKey: string | null;
  readonly merchantDocumentKey: string | null;
};

export type StrongPeerDocumentField = keyof PeerDocumentKeys;

export type StrongPeerCandidateField = StrongPeerDocumentField | 'counterpartyDocumentKey';

export type StrongPeerAmountSign = 'negative' | 'positive' | 'any';

export type StrongPeerPolicyTerm = {
  readonly targetField: StrongPeerDocumentField;
  readonly candidateField: StrongPeerCandidateField;
  readonly candidateAmountSign: StrongPeerAmountSign;
};

/**
 * The canonical strong-peer policy. Consumers choose how to evaluate these
 * terms, so the policy remains independent of storage and SQL.
 */
export function createStrongPeerPolicy(amountCents: number): readonly StrongPeerPolicyTerm[] {
  const terms: StrongPeerPolicyTerm[] = [
    {
      targetField: 'merchantDocumentKey',
      candidateField: 'merchantDocumentKey',
      candidateAmountSign: 'any',
    },
  ];
  const counterpartyField = counterpartyDocumentField(amountCents);
  if (!counterpartyField) {
    return terms;
  }

  const amountSign = amountCents < 0 ? 'negative' : 'positive';
  terms.push(
    {
      targetField: 'merchantDocumentKey',
      candidateField: 'counterpartyDocumentKey',
      candidateAmountSign: 'any',
    },
    {
      targetField: counterpartyField,
      candidateField: 'merchantDocumentKey',
      candidateAmountSign: 'any',
    },
    {
      targetField: counterpartyField,
      candidateField: counterpartyField,
      candidateAmountSign: amountSign,
    },
  );
  return terms;
}

export function resolveStrongSharedPeerDocumentKey(
  targetKeys: PeerDocumentKeys,
  targetAmountCents: number,
  candidateKeys: PeerDocumentKeys,
  candidateAmountCents: number,
): string | null {
  for (const term of createStrongPeerPolicy(targetAmountCents)) {
    if (!matchesStrongPeerAmountSign(candidateAmountCents, term.candidateAmountSign)) {
      continue;
    }
    const targetKey = readPeerDocumentField(targetKeys, term.targetField);
    const candidateKey = readPeerCandidateDocumentField(
      candidateKeys,
      term.candidateField,
      candidateAmountCents,
    );
    if (targetKey && targetKey === candidateKey) {
      return targetKey;
    }
  }
  return null;
}

export function readPeerDocumentField(
  keys: PeerDocumentKeys,
  field: StrongPeerDocumentField,
): string | null {
  switch (field) {
    case 'payerDocumentKey':
      return keys.payerDocumentKey;
    case 'receiverDocumentKey':
      return keys.receiverDocumentKey;
    case 'merchantDocumentKey':
      return keys.merchantDocumentKey;
  }
}

export function readPeerCandidateDocumentField(
  keys: PeerDocumentKeys,
  field: StrongPeerCandidateField,
  amountCents: number,
): string | null {
  if (field === 'counterpartyDocumentKey') {
    const counterpartyField = counterpartyDocumentField(amountCents);
    return counterpartyField ? readPeerDocumentField(keys, counterpartyField) : null;
  }
  return readPeerDocumentField(keys, field);
}

export function matchesStrongPeerAmountSign(
  amountCents: number,
  sign: StrongPeerAmountSign,
): boolean {
  return (
    sign === 'any' ||
    (sign === 'negative' && amountCents < 0) ||
    (sign === 'positive' && amountCents > 0)
  );
}

function counterpartyDocumentField(amountCents: number): StrongPeerDocumentField | null {
  if (amountCents < 0) {
    return 'receiverDocumentKey';
  }
  if (amountCents > 0) {
    return 'payerDocumentKey';
  }
  return null;
}
