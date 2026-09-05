/**
 * Configuration hub (Section 3) — Salary Structures + Rules navigation.
 * Shows structures list; clicking a structure drills into its rules.
 */
import { useState } from 'react';
import SalaryStructures from './SalaryStructures.jsx';
import SalaryRules from './SalaryRules.jsx';

export default function ConfigIndex() {
  const [selected, setSelected] = useState(null); // { id, name }

  if (selected) {
    return (
      <SalaryRules
        structureId={selected.id}
        structureName={selected.name}
        onBack={() => setSelected(null)}
      />
    );
  }

  return <SalaryStructures onSelect={(s) => setSelected(s)} />;
}
