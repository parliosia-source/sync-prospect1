import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";

const SECTORS = [
  "Finance & Assurance", "Santé & Pharma", "Technologie", "Gouvernement & Public",
  "Éducation & Formation", "Associations & OBNL", "Immobilier", "Droit & Comptabilité",
  "Industrie & Manufacture", "Commerce de détail", "Transport & Logistique", "Autre"
];

const LOCATIONS = [
  { value: "MONTREAL", label: "Montréal", query: "Montréal, QC" },
  { value: "QUEBEC_CITY", label: "Ville de Québec", query: "Québec, QC" },
  { value: "CANADA", label: "Canada", query: "Canada" },
];

export default function CampaignModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({
    name: "", targetCount: 50, industrySectors: [], companySize: "MID",
    locationMode: "CITY", locationQuery: "Montréal, QC", locationKey: "MONTREAL", keywords: [],
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
    if (kw && !form.keywords.includes(kw)) {
      setForm(f => ({ ...f, keywords: [...f.keywords, kw] }));
    }
    setKwInput("");
  };

  const handleSave = async () => {
    if (!form.name || !form.locationQuery) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle campagne de prospection</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Nom de la campagne *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Entreprises QC Automne 2025" className="mt-1" />
          </div>

          <div>
            <Label className="mb-2 block">Secteurs d'activité</Label>
            <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
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

            <div>
              <Label>Objectif prospects</Label>
              <Select value={String(form.targetCount)} onValueChange={v => setForm(f => ({ ...f, targetCount: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 prospects</SelectItem>
                  <SelectItem value="100">100 prospects</SelectItem>
                  <SelectItem value="150">150 prospects</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Zone géographique</Label>
              <Select value={form.locationMode} onValueChange={v => setForm(f => ({ ...f, locationMode: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CITY">Ville</SelectItem>
                  <SelectItem value="REGION">Région</SelectItem>
                  <SelectItem value="COUNTRY">Pays</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Localisation *</Label>
              <Input value={form.locationQuery} onChange={e => setForm(f => ({ ...f, locationQuery: e.target.value }))}
                placeholder="Ex: Montréal, QC" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Mots-clés additionnels</Label>
            <div className="flex gap-2 mt-1">
              <Input value={kwInput} onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addKeyword()}
                placeholder="Ex: conférence annuelle" />
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.locationQuery} className="bg-blue-600 hover:bg-blue-700">
            {saving ? "Création..." : "Créer la campagne"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}