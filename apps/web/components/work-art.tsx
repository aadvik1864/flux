// Original inline artwork: no images, scene downloads, timers, or animation loops.
// CSS ties the movement to the containing link's hover or keyboard focus.
export function DocumentArtwork() {
  return <span className="document-artwork" aria-hidden="true">
    <svg viewBox="0 0 160 112" fill="none">
      <ellipse cx="80" cy="98" rx="43" ry="5" className="document-art-shadow" />
      <g className="document-art-back"><rect x="49" y="21" width="65" height="78" rx="5" className="art-tint" /><path d="M61 39h36M61 48h27" className="art-stroke" strokeWidth="2" strokeLinecap="round" /></g>
      <g className="document-art-page"><path d="M46 14h49l17 17v57a5 5 0 0 1-5 5H46a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5Z" className="art-paper" /><path d="M95 14v12a5 5 0 0 0 5 5h12" className="art-fold" /><path d="M53 45h39M53 55h30M53 65h36M53 75h22" className="art-lines" strokeWidth="3" strokeLinecap="round" /><path d="M84 65h15" className="art-highlight" strokeWidth="7" strokeLinecap="round" /></g>
      <g className="document-art-cursor"><path d="m115 63 3 16 4-6 7-2-14-8Z" className="art-solid" /><rect x="117" y="84" width="22" height="7" rx="3.5" className="art-solid" /></g>
    </svg>
  </span>;
}

export function CheckpointArtwork() {
  return <svg className="checkpoint-artwork" viewBox="0 0 240 142" fill="none" aria-hidden="true">
    <path d="M19 112c38-16 57-40 85-29s56 47 117 19" className="checkpoint-thread" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 6" />
    <g className="checkpoint-page checkpoint-page-back"><rect x="75" y="26" width="84" height="93" rx="7" className="art-orchid" /><path d="M89 45h44M89 55h32" stroke="#754584" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="checkpoint-page checkpoint-page-middle"><rect x="75" y="26" width="84" height="93" rx="7" className="art-slate" /><path d="M89 45h44M89 55h32" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="checkpoint-page checkpoint-page-front"><rect x="75" y="26" width="84" height="93" rx="7" className="art-paper" /><path d="M91 49h44M91 60h30M91 71h38M91 82h26" className="art-lines" strokeWidth="3" strokeLinecap="round" /><path d="M136 26v31l-9-6-9 6V26" className="art-coral" /></g>
    <g className="checkpoint-seal"><circle cx="165" cy="104" r="17" className="art-coral" /><path d="m158 104 5 5 9-10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>
  </svg>;
}

export function WorkspaceArtwork() {
  return <svg className="workspace-artwork" viewBox="0 0 240 150" fill="none" aria-hidden="true">
    <ellipse cx="117" cy="78" rx="92" ry="65" className="art-ground" />
    <path d="M46 53a7 7 0 0 1 7-7h44l12 12h79a7 7 0 0 1 7 7v61H46V53Z" className="art-slate" />
    <g className="workspace-art-page-left"><rect x="64" y="28" width="61" height="89" rx="5" className="art-orchid" /><path d="M76 45h34M76 56h24M76 67h30" stroke="#754584" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="workspace-art-page-right"><rect x="121" y="37" width="57" height="80" rx="5" className="art-paper" /><path d="M132 53h31M132 64h22M132 75h28" className="art-lines" strokeWidth="3" strokeLinecap="round" /><path d="M163 37v29l-7-5-7 5V37" className="art-coral" /></g>
    <g className="workspace-art-cover"><path d="M48 75h147a6 6 0 0 1 6 7l-10 44a7 7 0 0 1-7 6H57a7 7 0 0 1-7-6L42 82a6 6 0 0 1 6-7Z" className="art-coral" /><path d="M64 93h47" stroke="#fff" strokeOpacity=".75" strokeWidth="4" strokeLinecap="round" /><path d="M64 103h28" stroke="#fff" strokeOpacity=".4" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="workspace-art-cursor"><path d="m198 39 3 18 5-7 8-2-16-9Z" className="art-orchid" /><rect x="200" y="64" width="24" height="7" rx="3.5" className="art-orchid" /></g>
  </svg>;
}

export function PeopleArtwork() {
  return <svg className="people-artwork" viewBox="0 0 240 150" fill="none" aria-hidden="true">
    <ellipse cx="119" cy="78" rx="85" ry="62" className="art-ground" />
    <path d="M61 94c29 33 77 33 118-4" className="people-art-thread" strokeWidth="2" strokeDasharray="4 5" />
    <g className="people-art-left"><rect x="31" y="37" width="62" height="76" rx="13" className="art-orchid" /><circle cx="62" cy="59" r="12" fill="#f4d9f4" /><path d="M42 101V93a20 20 0 0 1 40 0v8" fill="#754584" /><path d="M51 58c3-12 17-11 23 0" stroke="#754584" strokeWidth="5" strokeLinecap="round" /></g>
    <g className="people-art-right"><rect x="151" y="27" width="62" height="76" rx="13" className="art-slate" /><circle cx="182" cy="49" r="12" fill="#f5b49d" /><path d="M162 91v-8a20 20 0 0 1 40 0v8" fill="#a9c6e9" /><path d="M171 48c3-12 17-11 23 0" stroke="#263449" strokeWidth="5" strokeLinecap="round" /></g>
    <g className="people-art-envelope"><rect x="90" y="68" width="57" height="43" rx="5" className="art-coral" /><path d="m92 73 26 19 27-19" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><path d="m92 107 17-14m36 14-18-14" stroke="#fff" strokeOpacity=".5" strokeWidth="2" /></g>
  </svg>;
}

export function HistoryArtwork() {
  return <svg className="history-artwork" viewBox="0 0 240 150" fill="none" aria-hidden="true">
    <ellipse cx="119" cy="76" rx="86" ry="63" className="art-ground" />
    <path d="M29 117h43c18 0 20-32 40-32h61c19 0 21-38 39-38" className="history-art-thread" strokeWidth="3" strokeLinecap="round" />
    <g className="history-art-earlier"><rect x="48" y="47" width="60" height="74" rx="6" className="art-orchid" /><path d="M59 65h34M59 75h25M59 85h29" stroke="#754584" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="history-art-current"><rect x="119" y="22" width="68" height="89" rx="6" className="art-paper" /><path d="M133 49h36M133 60h28M133 71h33M133 82h23" className="art-lines" strokeWidth="3" strokeLinecap="round" /><path d="M171 22v28l-7-5-7 5V22" className="art-coral" /></g>
    <circle cx="29" cy="117" r="6" className="art-orchid" /><circle cx="112" cy="85" r="6" className="art-slate" /><circle cx="212" cy="47" r="7" className="art-coral" />
  </svg>;
}

export function SearchArtwork() {
  return <svg className="search-artwork" viewBox="0 0 240 150" fill="none" aria-hidden="true">
    <ellipse cx="119" cy="76" rx="83" ry="62" className="art-ground" />
    <g className="search-art-page"><rect x="68" y="23" width="77" height="103" rx="6" className="art-paper" /><path d="M82 44h45M82 56h31M82 68h41M82 80h28M82 92h37" className="art-lines" strokeWidth="3" strokeLinecap="round" /><rect x="81" y="65" width="42" height="7" rx="3.5" className="art-orchid" /></g>
    <g className="search-art-lens"><circle cx="148" cy="72" r="32" className="search-art-glass" /><circle cx="148" cy="72" r="32" stroke="#3f567f" strokeWidth="8" /><path d="m171 96 24 26" stroke="#e0563f" strokeWidth="12" strokeLinecap="round" /><path d="M133 58a19 19 0 0 1 17-7" stroke="#fff" strokeWidth="4" strokeLinecap="round" /></g>
  </svg>;
}

export function documentTone(id: string): "slate" | "orchid" | "coral" {
  // Stable across sorting/filtering: these are visual accents, not categories.
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (["slate", "orchid", "coral"] as const)[hash % 3];
}
