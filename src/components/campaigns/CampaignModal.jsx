import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";

const SECTORS = [
  "Finance & Assurance", "Santé & Pharma", "Technologie", "Gouvernement & Public",
  "Éducation & Formation", "Associations & OBNL", "Immobilier", "Droit & Comptabilité",
  "Industrie & Manufacture", "Commerce de détail", "Transport & Logistique",
];

const LOCATIONS = [
  { value: "MONTREAL", label: "Montréal", query: "Montréal, QC" },
  { value: "QUEBEC_CITY", label: "Québec", query: "Québec, QC" },
  { value: "CANADA", label: "Canada", query: "Canada" },
];

export default function CampaignModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({
    name: "", targetCount: 50, industrySectors: [], companySize: "ALL",
    locationMode: "CITY", locationQuery: "Montréal, QC", locationKey: "MONTREAL", keywords: [],
    customSector: "",
  });
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleSector = (s) => {
    setForm(f => ({
      ...f,
      industrySectors: f.industrySectors.includes(s)
        ? f.industrySectors.filter(x => x !== s)
        : [...f.industrySectors, s],
    }));
  };

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (kw && !form.keywords.includes(kw)) setForm(f => ({ ...f, keywords: [...f.keywords, kw] }));
    setKwInput("");
  };

  const handleSave = async (launch = false) => {
    if (!form.name || !form.locationQuery) return;
    setSaving(true);
    // Merge custom sector into industrySectors if provided
    const sectors = [...form.industrySectors];
    if (form.customSector.trim() && !sectors.includes(form.customSector.trim())) {
      sectors.push(form.customSector.trim());
    }
    const payload = { ...form, industrySectors: sectors };
    delete payload.customSector;
    await onSave(payload, launch);
    setSaving(false);
    onClose();
    // Reset form
    setForm({
      name: "", targetCount: 50, industrySectors: [], companySize: "ALL",
      locationMode: "CITY", locationQuery: "Montréal, QC", locationKey: "MONTREAL", keywords: [],
      customSector: "",
    });
  };

  const selectedLocation = LOCATIONS.find(l => l.value === form.locationKey);
  const allSectors = [...form.industrySectors, ...(form.customSector.trim() ? [form.customSector.trim()] : [])];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle campagne de prospection</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div>
            <Label>Nom de la campagne *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Assurances QC Automne 2026" className="mt-1" />
          </div>

          {/* Location */}
          <div>
            <Label className="mb-2 block">Localisation *</Label>
            <div className="flex gap-2">
              {LOCATIONS.map(loc => (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    locationKey: loc.value,
                    locationQuery: loc.query,
                    locationMode: loc.value === "CANADA" ? "COUNTRY" : "CITY"
                  }))}
                  className={`flex-1 py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    form.locationKey === loc.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sectors (presets) */}
          <div>
            <Label className="mb-2 block">Secteur d'activité <span className="text-slate-400 font-normal text-xs">(optionnel — tous secteurs si aucun sélectionné)</span></Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {SECTORS.map(s => (
                <button
                  key={s}
                  onClick={() => toggleSector(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    form.industrySectors.includes(s)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Custom free-text sector */}
            <div className="flex gap-2 mt-2">
              <Input
                value={form.customSector}
                onChange={e => setForm(f => ({ ...f, customSector: e.target.value }))}
                placeholder="Secteur libre (ex: agroalimentaire, médias…)"
                className="text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Objectif prospects</Label>
              <Select value={String(form.targetCount)} onValueChange={v => setForm(f => ({ ...f, targetCount: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 prospects</SelectItem>
                  <SelectItem value="50">50 prospects</SelectItem>
                  <SelectItem value="100">100 prospects</SelectItem>
                  <SelectItem value="150">150 prospects</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Taille d'entreprise</Label>
              <Select value={form.companySize} onValueChange={v => setForm(f => ({ ...f, companySize: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMALL">Petite (1-50)</SelectItem>
                  <SelectItem value="MID">Moyenne (50-500)</SelectItem>
                  <SelectItem value="LARGE">Grande (500+)</SelectItem>
                  <SelectItem value="ENTERPRISE">Entreprise (1000+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Keywords */}
          <div>
            <Label>Mots-clés additionnels</Label>
            <div className="flex gap-2 mt-1">
              <Input value={kwInput} onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addKeyword()}
                placeholder="Ex: conférence annuelle, gala" />
              <Button type="button" variant="outline" size="sm" onClick={addKeyword}><Plus className="w-4 h-4" /></Button>
            </div>
            {form.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.keywords.map(k => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs">
                    {k}
                    <button onClick={() => setForm(f => ({ ...f, keywords: f.keywords.filter(x => x !== k) }))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Criteria recap */}
          {form.name && (
            <div className="bg-slate-50 rounded-xl border p-3 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700 mb-1">Récapitulatif</div>
              <div>📍 <strong>Lieu :</strong> {selectedLocation?.label || form.locationQuery}</div>
              {allSectors.length > 0 && <div>🏢 <strong>Secteur :</strong> {allSectors.join(", ")}</div>}
              {form.keywords.length > 0 && <div>🔑 <strong>Mots-clés :</strong> {form.keywords.join(", ")}</div>}
              <div>🎯 <strong>Objectif :</strong> {form.targetCount} prospects</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving || !form.name || !form.locationQuery}>
            {saving ? "Création..." : "Brouillon"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || !form.name || !form.locationQuery} className="bg-blue-600 hover:bg-blue-700">
            {saving ? "Lancement..." : "Créer et lancer →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}