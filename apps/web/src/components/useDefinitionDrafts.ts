import { useLayoutEffect, useRef, useState } from 'react';
import type { ModelInput } from '../types';
import { reconcileDefinitionDrafts, type PropertyRow, type NameDraft } from './modelEditing';

export function useDefinitionDrafts(model: ModelInput) {
  const [properties, setProperties] = useState<Record<string, PropertyRow[]>>({});
  const [names, setNames] = useState<Record<string, NameDraft>>({});
  const previous = useRef(model);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = model;
    if (before === model) return;
    setProperties(current => reconcileDefinitionDrafts(before, model, current, {}).properties);
    setNames(current => reconcileDefinitionDrafts(before, model, {}, current).names);
  }, [model]);
  return { properties, setProperties, names, setNames };
}
