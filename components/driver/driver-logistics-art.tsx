"use client";

import { useId } from "react";

/** Decorative vector scene: no job, location or vehicle data is represented. */
export function DriverLogisticsArt() {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12] lg:opacity-100">
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor="#fff8eb" /><stop offset="1" stopColor="#ece1ce" />
        </linearGradient>
        <linearGradient id={`${id}-road`} x2="0.7" y2="1">
          <stop stopColor="#d6cec0" /><stop offset="1" stopColor="#eee6db" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x2="1" y2="1">
          <stop stopColor="#b9c4c7" /><stop offset="1" stopColor="#718590" />
        </linearGradient>
        <linearGradient id={`${id}-fade`}>
          <stop stopColor="#fffbf3" /><stop offset=".23" stopColor="#fffbf3" stopOpacity=".96" />
          <stop offset=".43" stopColor="#fffbf3" stopOpacity=".1" />
          <stop offset=".76" stopColor="#fffbf3" stopOpacity="0" />
          <stop offset="1" stopColor="#f6eddf" stopOpacity=".85" />
        </linearGradient>
      </defs>
      <rect width="1200" height="280" fill={`url(#${id}-sky)`} />
      <circle cx="795" cy="62" r="39" fill="#ffd39a" opacity=".75" />
      <path d="M350 128 420 107 464 122 537 104 591 122 659 98 722 128 852 106 970 130 1200 112V183H350Z" fill="#d9d0bf" opacity=".35" />
      <g fill="#c6c2b6" opacity=".45">
        <path d="M387 153V98h15v55m12 0V81h19v72m14 0v-39h13v39m31 0V71h20v82m14 0v-52h15v52m24 0V92h24v61m20 0V55h19v98m12 0V84h22v69m23 0V37h21v116m13 0V72h26v81m229 0V28h24v125m14 0V66h18v87" />
      </g>
      <g stroke="#fffbf3" strokeWidth="2" opacity=".3">
        <path d="M420 89v62m75-71v72m136-107v106m17-66v66m235-119v120" />
        <path d="M418 106h13m61-7h15m119-22h20m0 26h20m218-43h20m-20 26h20" />
      </g>
      <g fill="#a9b09b" opacity=".5">
        <path d="M490 160c-20-25 7-42 18-25 12-30 40-13 32 7 32-23 45 8 28 20m331 0c-19-28 10-44 23-23 10-36 37-18 35 2 32-22 52 0 35 24m14-5c-12-32 15-40 25-19 19-32 40-14 36 5 33-16 47 7 26 20" />
      </g>
      {/* Warehouse roof, glazed facade and loading bays in perspective. */}
      <g>
        <path d="m650 102 144-54 126 26-141 61Z" fill="#6d7c83" />
        <path d="m650 109 129 32v59l-129-31Z" fill="#c8c4b9" />
        <path d="m779 141 141-54v111l-141 2Z" fill="#e1dacc" />
        <path d="m650 109 144-54 126 26-141 55Z" fill="#c4c4bd" />
        <path d="m650 109 129 27 141-55" fill="none" stroke="#6c7980" strokeWidth="5" />
        <path d="m679 122 72 16v40l-72-17Z" fill={`url(#${id}-glass)`} opacity=".65" />
        <g fill="none" stroke="#9ca6a5" strokeWidth="1">
          <path d="M693 126v37m15-34v38m15-35v39m14-36v39m-58-34 72 17m-72-3 72 17" />
          <path d="M803 128v70m24-80v80m25-89v89m26-98v98m24-107v107m-123-40 141-38m-141 60 141-27" />
        </g>
        <path d="m804 161 23-6v40l-23 1Zm48-12 25-7v53l-25 1Z" fill="#9ca6a2" />
        <g fill="#d4ad77" stroke="#b88d59" strokeWidth="1">
          <path d="m764 176 16-3 16 4v21l-16 2-16-3Z" />
          <path d="m810 180 15-2 13 3v18l-13 2-15-3Z" />
          <path d="m826 162 14-3 13 4v17l-13 2-14-3Z" />
        </g>
        <text x="801" y="146" fill="#d66a29" fontSize="20" fontWeight="900" fontFamily="Arial, sans-serif" transform="rotate(-15 801 146)">EES</text>
      </g>
      {/* Road converges toward the depot; route pins are decorative, not live stops. */}
      <path d="M331 151 563 166 1200 241V280H208Z" fill={`url(#${id}-road)`} />
      <g fill="none" stroke="#fffaf1">
        <path d="M345 156 907 280m-504-119 734 119m-661-117 724 94" strokeWidth="2" opacity=".7" />
        <path d="M412 164 1016 280" strokeWidth="3" strokeDasharray="23 19" opacity=".8" />
      </g>
      <path d="M303 151c116-14 36 22 112 34s160 9 248 23l238 28" fill="none" stroke="#ec812f" strokeWidth="3" strokeDasharray="10 10" opacity=".8" />
      <g fill="#ed7e2f" stroke="#fff4df" strokeWidth="2">
        <path d="M436 159c-5-8-16-19-16-29a16 16 0 0 1 32 0c0 10-11 21-16 29Z" />
        <path d="M895 237c-5-8-16-19-16-29a16 16 0 0 1 32 0c0 10-11 21-16 29Z" />
      </g>
      <g fill="#fff4df"><circle cx="436" cy="130" r="6" /><circle cx="895" cy="208" r="6" /></g>
      {/* EES box lorry with container ribs, cab glazing and paired rear wheels. */}
      <g transform="translate(557 165)">
        <ellipse cx="87" cy="63" rx="96" ry="9" fill="#52616a" opacity=".13" />
        <path d="M0 5 91 0l23 9v43L0 48Z" fill="#eee7d8" stroke="#a9aaa3" />
        <path d="m91 0 23 9v43l-23-8Z" fill="#c9c8bd" />
        <g stroke="#c0bbb0" strokeWidth="1"><path d="M9 7v39m7-39v39m7-40v40m7-40v40m7-41v41m7-41v41m7-42v42m7-42v42m7-43v43m7-43v43m7-44v44" /></g>
        <text x="29" y="32" fill="#db6426" fontSize="24" fontWeight="900" fontFamily="Arial, sans-serif" transform="rotate(-3 29 32)">EES</text>
        <path d="M0 49h158v8H0Z" fill="#596770" />
        <path d="m112 13 29 2 17 17v24h-46Z" fill="#eeeade" stroke="#89979c" />
        <path d="m141 15 17 17h-28l-6-16Z" fill="#253e4d" />
        <path d="m158 32 9 3v19l-9 2Z" fill="#b3bbb8" />
        <path d="M130 39h27m-27 5h27m-26 5h25" stroke="#657681" strokeWidth="2" />
        <path d="M119 17v16h-7V17Z" fill="#486170" />
        <path d="M150 30h19v7" fill="none" stroke="#52616a" strokeWidth="2" />
        <g fill="#253642" stroke="#667680" strokeWidth="2"><ellipse cx="14" cy="55" rx="6" ry="10" /><ellipse cx="30" cy="55" rx="6" ry="10" /><ellipse cx="100" cy="58" rx="6" ry="10" /><ellipse cx="145" cy="59" rx="7" ry="11" /></g>
        <g fill="#a8b0af"><ellipse cx="14" cy="55" rx="2" ry="5" /><ellipse cx="30" cy="55" rx="2" ry="5" /><ellipse cx="100" cy="58" rx="2" ry="5" /><ellipse cx="145" cy="59" rx="3" ry="6" /></g>
        <path d="M159 48h8v5h-8Z" fill="#e6ab68" />
      </g>
      {/* Readability veil leaves the scene visible between the live identity and plate. */}
      <rect width="1200" height="280" fill={`url(#${id}-fade)`} />
    </svg>
  );
}
