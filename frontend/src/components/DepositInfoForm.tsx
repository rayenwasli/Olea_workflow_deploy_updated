import React, { useEffect, useMemo, useState } from 'react';
import type { AssureurDto, DepositDocumentType, ResponsableDto, RoleName } from '../types';

function isKnown(list: readonly string[], v: string) {
  return !!v && list.includes(v);
}

export function DepositInfoForm({
  role,
  bordereauReference,
  assureur,
  setAssureur,
  assureurOptions,
  depotRef,
  setDepotRef,
  responsable,
  setResponsable,
  responsableOptions,
  docTypes,
  setDocTypes,
  documentTypeOptions,
}: {
  role: RoleName;
  bordereauReference?: string;
  assureur: string;
  setAssureur: (v: string) => void;
  assureurOptions?: AssureurDto[];
  depotRef: string;
  setDepotRef: (v: string) => void;
  responsable: string;
  setResponsable: (v: string) => void;
  responsableOptions?: ResponsableDto[];
  docTypes: DepositDocumentType[];
  setDocTypes: (v: DepositDocumentType[]) => void;
  documentTypeOptions?: string[];
}) {
  const hasAssureurOptions = useMemo(() => (assureurOptions?.length || 0) > 0, [assureurOptions]);
  const assureurNames = useMemo(() => (assureurOptions || []).map((a) => a.name), [assureurOptions]);
  const assureurKnown = useMemo(() => (hasAssureurOptions ? isKnown(assureurNames, assureur) : false), [hasAssureurOptions, assureurNames, assureur]);
  const [assureurMode, setAssureurMode] = useState<'NONE' | 'KNOWN' | 'OTHER'>('NONE');

  useEffect(() => {
    if (!hasAssureurOptions) return;
    // Keep the UI consistent when values are loaded from the API.
    if (assureurKnown) setAssureurMode('KNOWN');
    else if (assureur) setAssureurMode('OTHER');
    // if assureur empty, keep current mode (lets user pick "Autre…" and then type)
  }, [assureur, assureurKnown]);

  const assureurSelectValue = useMemo(() => {
    if (!hasAssureurOptions) return '';
    if (assureurKnown) return assureur;
    if (assureurMode === 'OTHER') return 'OTHER';
    return '';
  }, [assureur, assureurKnown, assureurMode]);

  const depotReadOnly = role === 'COORDINATEUR';

  const hasResponsableOptions = useMemo(() => (responsableOptions?.length || 0) > 0, [responsableOptions]);
  const responsableKnown = useMemo(
    () => (hasResponsableOptions ? !!responsableOptions?.some((r) => r.email === responsable) : false),
    [hasResponsableOptions, responsableOptions, responsable]
  );
  const [responsableMode, setResponsableMode] = useState<'NONE' | 'KNOWN' | 'OTHER'>('NONE');

  useEffect(() => {
    if (!hasResponsableOptions) return;
    if (responsableKnown) setResponsableMode('KNOWN');
    else if (responsable) setResponsableMode('OTHER');
  }, [hasResponsableOptions, responsableKnown, responsable]);

  const responsableSelectValue = useMemo(() => {
    if (!hasResponsableOptions) return '';
    if (responsableKnown) return responsable;
    if (responsableMode === 'OTHER') return 'OTHER';
    return '';
  }, [hasResponsableOptions, responsableKnown, responsableMode, responsable]);

  const totalDocs = useMemo(
    () => (docTypes || []).reduce((a, d) => a + (Number(d?.nombre) || 0), 0),
    [docTypes]
  );

  const updateDoc = (idx: number, patch: Partial<DepositDocumentType>) => {
    const next = [...docTypes];
    next[idx] = { ...next[idx], ...patch };
    setDocTypes(next);
  };

  const removeDoc = (idx: number) => {
    const next = docTypes.filter((_, i) => i !== idx);
    setDocTypes(next.length ? next : [{ typeDocument: '', nombre: 1 }]);
  };

  const addDoc = () => setDocTypes([...(docTypes || []), { typeDocument: '', nombre: 1 }]);

  return (
    <div className="section">
      <div className="section-title mb-3">Informations dépôt</div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="field">
          <label>Assureur</label>
          {hasAssureurOptions ? (
            <>
          <select
            className="input"
            value={assureurSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'OTHER') {
                setAssureurMode('OTHER');
                if (assureurKnown) setAssureur('');
              } else {
                setAssureurMode('KNOWN');
                setAssureur(v);
              }
            }}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {(assureurOptions || []).map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
            <option value="OTHER">Autre…</option>
          </select>
          {assureurSelectValue === 'OTHER' ? (
            <input
              className="input"
              value={assureur}
              onChange={(e) => setAssureur(e.target.value)}
              placeholder="Saisir l’assureur"
            />
          ) : null}
              <div className="help">Liste des assureurs (configurable via Admin).</div>
            </>
          ) : (
            <input
              className="input"
              value={assureur}
              onChange={(e) => setAssureur(e.target.value)}
              placeholder="Saisir l’assureur"
            />
          )}

        </div>

        <div className="field">
          <label>Référence dépôt</label>
          <input
            className={[
              'input',
              depotReadOnly ? 'bg-slate-100/80 text-slate-900' : '',
            ].join(' ')}
            value={depotRef}
            onChange={(e) => setDepotRef(e.target.value)}
            readOnly={depotReadOnly}
            placeholder={bordereauReference ? `Ex: ${bordereauReference}` : 'Référence dépôt'}
          />
          {depotReadOnly ? (
            <div className="help">Remplie automatiquement (Bureau d’ordre).</div>
          ) : null}
        </div>

        <div className="field sm:col-span-2">
          <label>Responsable</label>
          {hasResponsableOptions ? (
            <>
              <select
                className="input"
                value={responsableSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'OTHER') {
                    setResponsableMode('OTHER');
                    if (responsableKnown) setResponsable('');
                  } else {
                    setResponsableMode('KNOWN');
                    setResponsable(v);
                  }
                }}
              >
                <option value="" disabled>
                  Choisir…
                </option>
                {(responsableOptions || []).map((r) => (
                  <option key={r.id} value={r.email}>
                    {r.email}
                  </option>
                ))}
                <option value="OTHER">Autre…</option>
              </select>

              {responsableSelectValue === 'OTHER' ? (
                <input
                  className="input"
                  value={responsable}
                  onChange={(e) => setResponsable(e.target.value)}
                  placeholder="Saisir le responsable (email / nom)"
                />
              ) : null}

              <div className="help">Liste des responsables client affectés à ce client.</div>
            </>
          ) : (
            <input
              className="input"
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              placeholder="Saisir le responsable (email / nom)"
            />
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="section-title">Types de documents</div>
          <div className="muted">Total: {totalDocs}</div>
        </div>

        <div className="mt-3 space-y-3">
          {docTypes.map((d, idx) => {
            const docKnown = isKnown(documentTypeOptions || [], d.typeDocument);
            const docSelectValue = docKnown ? d.typeDocument : '';

            return (
              <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-7">
                  <div className="field">
                    <label>Type</label>
                    <select
                      className="input"
                      value={docSelectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = [...docTypes];
                        (next[idx] as any)._uiOther = false;
                        next[idx] = { ...next[idx], typeDocument: v };
                        setDocTypes(next);
                      }}
                    >
                      <option value="" disabled>
                        Choisir…
                      </option>
                      {(documentTypeOptions || []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>

                  </div>
                </div>

                <div className="sm:col-span-3">
                  <div className="field">
                    <label>Nombre</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={d.nombre}
                      onChange={(e) => updateDoc(idx, { nombre: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <button
                    className="btn danger w-full"
                    onClick={() => removeDoc(idx)}
                    type="button"
                    disabled={docTypes.length <= 1}
                    title={docTypes.length <= 1 ? 'Au moins un type est requis' : 'Supprimer'}
                  >
                    Suppr
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <button className="btn" onClick={addDoc} type="button">
            + Ajouter un type
          </button>
        </div>
      </div>
    </div>
  );
}
