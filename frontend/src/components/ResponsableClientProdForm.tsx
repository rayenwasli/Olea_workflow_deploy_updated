import React from 'react';


const NATURE_DEMANDE_OPTIONS = [
  'Intégration retraité',
  'Intégration actif',
  'Mise à jour bénéficiaire',
  'Ajout du NV née',
  'Passage du post',
  'Ajout bénéficiaire',
  'demande de mutation',
  'maladie chronique',
  'Chagement beneficiaire deces',
];

type Props = {
  mode: 'INITIAL' | 'FOLLOW_UP';
  clientName?: string | null;
  matricule: string;
  setMatricule: (v: string) => void;
  nomPrenomPrestataire: string;
  setNomPrenomPrestataire: (v: string) => void;
  natureDemande: string;
  setNatureDemande: (v: string) => void;
  documentsEnvoyes: string;
  setDocumentsEnvoyes: (v: string) => void;
  dateAdhesionEffet: string;
  setDateAdhesionEffet: (v: string) => void;
  dateReceptionClient: string;
  setDateReceptionClient: (v: string) => void;
  dateEnvoiAssureurDecharge: string;
  setDateEnvoiAssureurDecharge: (v: string) => void;
  execution: string;
  setExecution: (v: string) => void;
  dateExecution: string;
  setDateExecution: (v: string) => void;
  remarque: string;
  setRemarque: (v: string) => void;
};

export function ResponsableClientProdForm({
  mode,
  clientName,
  matricule,
  setMatricule,
  nomPrenomPrestataire,
  setNomPrenomPrestataire,
  natureDemande,
  setNatureDemande,
  documentsEnvoyes,
  setDocumentsEnvoyes,
  dateAdhesionEffet,
  setDateAdhesionEffet,
  dateReceptionClient,
  setDateReceptionClient,
  dateEnvoiAssureurDecharge,
  setDateEnvoiAssureurDecharge,
  execution,
  setExecution,
  dateExecution,
  setDateExecution,
  remarque,
  setRemarque,
}: Props) {
  const isFollowUp = mode === 'FOLLOW_UP';

  return (
    <div className="section" style={{ marginTop: 12 }}>
      <div className="section-title mb-3">
        {isFollowUp ? 'Suivi après retour de décharge' : 'Formulaire Responsable Client Prod'}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="field">
          <label>Client</label>
          <input className="input bg-slate-100/80 text-slate-900" value={clientName ?? ''} readOnly />
        </div>
        <div className="field">
          <label>Matricule</label>
          <input className="input" value={matricule} onChange={(e) => setMatricule(e.target.value)} />
        </div>

        <div className="field sm:col-span-2">
          <label>Nom prénom prestataire</label>
          <input className="input" value={nomPrenomPrestataire} onChange={(e) => setNomPrenomPrestataire(e.target.value)} />
        </div>

        <div className="field">
          <label>Nature de la demande</label>
          <select className="input" value={natureDemande} onChange={(e) => setNatureDemande(e.target.value)}>
            <option value="">Choisir…</option>
            {NATURE_DEMANDE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Documents envoyés</label>
          <input className="input" value={documentsEnvoyes} onChange={(e) => setDocumentsEnvoyes(e.target.value)} />
        </div>

        <div className="field">
          <label>Date d'adhésion / d'effet</label>
          <input className="input" type="date" value={dateAdhesionEffet} onChange={(e) => setDateAdhesionEffet(e.target.value)} />
        </div>

        <div className="field">
          <label>Date de réception de la part du client</label>
          <input className="input" type="date" value={dateReceptionClient} onChange={(e) => setDateReceptionClient(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Date d'envoi à l'assureur// Décharge</label>
          <input className="input" type="date" value={dateEnvoiAssureurDecharge} onChange={(e) => setDateEnvoiAssureurDecharge(e.target.value)} />
        </div>

        <div className="field">
          <label>Exécution</label>
          <input className="input" value={execution} onChange={(e) => setExecution(e.target.value)} placeholder="Saisir l'exécution" />
        </div>

        <div className="field">
          <label>Date d'exécution</label>
          <input className="input" type="date" value={dateExecution} onChange={(e) => setDateExecution(e.target.value)} />
        </div>

        <div className="field sm:col-span-2">
          <label>Remarque</label>
          <textarea className="input" value={remarque} onChange={(e) => setRemarque(e.target.value)} placeholder="Notes, retour bureau d'ordre, détails…" />
        </div>
      </div>

      {!isFollowUp ? (
        <div className="help" style={{ marginTop: 8 }}>
          Les champs de suivi final peuvent être laissés vides ici. Ils seront complétés plus tard après retour de la décharge par le bureau d'ordre.
        </div>
      ) : null}
    </div>
  );
}
