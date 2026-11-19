// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { nivelesEs } from "./niveles";

export const nivelesEn: { [K in keyof typeof nivelesEs]: string } = {
  "pie.niveles": "How levels work",
  "niveles.titulo": "How levels work",
  "niveles.intro":
    "Every profile has experience, a level, skills and stats that can be improved. This page explains how it all works, step by step.",
  "niveles.s1.titulo": "1. Experience comes from likes",
  "niveles.s1.texto":
    "Any visitor can give a profile one like per day. Each like adds {xp} experience points (EXP). There is nothing else to do: experience grows by itself with the community’s love.",
  "niveles.s2.titulo": "2. Fill the bar and you level up",
  "niveles.s2.texto":
    "The experience bar fills up with likes. When it reaches the end, the profile levels up and the bar starts again from zero. Each level asks for a bit more than the last, so leveling gets slower and slower: the first one needs {base} EXP and every next level needs {paso} more.",
  "niveles.tabla.titulo": "What each level asks for",
  "niveles.tabla.nivel": "To reach level",
  "niveles.tabla.exp": "Bar EXP",
  "niveles.tabla.likes": "Approx. likes",
  "niveles.s3.titulo": "3. Total EXP is never erased",
  "niveles.s3.texto":
    "Even though the bar empties when you level up, the profile keeps a running count of all the experience it has ever earned: the “total EXP”. It never goes down or resets. You can see it on the profile, under the bar.",
  "niveles.s4.titulo": "4. Every level gives you skill points",
  "niveles.s4.texto":
    "Every time your profile levels up thanks to likes, you earn {pts} skill points. Each point improves one of your skills by one rank, up to rank {max}. Points never expire: you can save them and spend them whenever you like.",
  "niveles.s4.aviso":
    "Only the levels you gain since your profile joined VTuberDex count; the level it started with gives no points.",
  "niveles.sStats.titulo": "Stat points",
  "niveles.sStats.texto":
    "Besides skills, every level you gain gives you {ptsStats} stat points. They raise HP, MP, Attack, Magic Attack, Defense and Magic Defense: each point adds a fixed amount (HP +50, MP +25, the rest +5). You spend them in “My profile” and they show on your public profile.",
  "niveles.sStats.auto":
    "Speed, Evasion, Accuracy and Critical grow on their own: +1 every {cadaRapido} levels gained. Luck grows +1 every {cadaSuerte} levels, up to a maximum of {topeSuerte}. Evasion never goes past 100. These do not cost points.",
  "niveles.sStats.aviso":
    "Stat points and skill points are separate pools: they are never mixed.",
  "niveles.s5.titulo": "5. How to spend your points",
  "niveles.s5.paso1":
    "When your profile levels up, an email arrives at the address you registered it with.",
  "niveles.s5.paso2":
    "Press the button in the email: you enter “My profile” without a password.",
  "niveles.s5.paso3":
    "Pick the skills and stats you want to improve and press “Upgrade”. The change shows up right away on your public profile.",
  "niveles.s5.nota":
    "The email link lasts 7 days and you can use it several times. If it expires or you lost it, ask for a new one in “My profile” with your email.",
  "niveles.s5.boton": "Go to My profile",
  "niveles.s6.titulo": "Frequently asked questions",
  "niveles.q1": "Can I change how I spent my points?",
  "niveles.a1":
    "Yes. In “My profile” the “Respec” button gives you all your points back so you can spend them again.",
  "niveles.q2": "What if my profile has no email?",
  "niveles.a2":
    "Profiles from the original catalog have no associated email, so they level up but get no notice and cannot spend points. Profiles registered through the form do.",
  "niveles.q3": "What if the email does not arrive?",
  "niveles.a3":
    "Check your spam folder. If it is not there, go to “My profile” and ask for the link again with the same email you registered with.",
  "niveles.q4": "Do ranks give any advantage?",
  "niveles.a4":
    "They are recognition: they show as a badge on each skill of your public profile.",
  "niveles.volver": "← Back to the catalog",
  "niveles.ejemplo": "Example",
  "niveles.flujo.titulo": "The whole path, in 4 steps",
  "niveles.flujo.1.t": "Get likes",
  "niveles.flujo.1.d": "Each visitor can give 1 like per day.",
  "niveles.flujo.2.t": "Level up",
  "niveles.flujo.2.d":
    "When the bar fills, the profile moves to the next level.",
  "niveles.flujo.3.t": "You get an email",
  "niveles.flujo.3.d": "With a button to sign in without a password.",
  "niveles.flujo.4.t": "Spend the points",
  "niveles.flujo.4.d": "Choose which skills and stats to improve.",
  "niveles.g1.titulo": "The bar empties, the total keeps growing",
  "niveles.g1.texto":
    "Top: each level’s bar, which fills and goes back to zero when you level up. Bottom: total EXP, which only goes up. Both come from the same likes.",
  "niveles.g1.barra": "Level bar",
  "niveles.g1.total": "Total EXP",
  "niveles.g1.likes": "Likes received",
  "niveles.g1.nivel": "Level {n}",
  "niveles.g2.titulo": "Each level asks for a bit more",
  "niveles.g2.texto":
    "Each bar is the EXP that level needs to reach the next one. That is why the first levels fly by and the high ones ask for patience.",
  "niveles.g2.eje": "EXP each level asks for",
  "niveles.m1.titulo": "How it looks on your public profile",
  "niveles.m1.texto":
    "Under the name you will see your level, the bar, the total EXP and, on every skill you improve, a badge with its rank.",
  "niveles.m2.titulo": "How “My profile” looks",
  "niveles.m2.texto":
    "The big number is your available points. Each skill has its “Upgrade” button; the dots show its rank.",
  "niveles.m3.titulo": "Ranks at a glance",
  "niveles.m3.texto":
    "Each point fills a dot. With {max} dots the skill is at its maximum rank.",
  "niveles.ej.nombre": "Luna Nova",
  "niveles.ej.hab1": "Star Ray",
  "niveles.ej.hab2": "Sweet Voice",
  "niveles.ej.hab3": "Grand Finale",
};
