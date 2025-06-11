// villaEvents.js

import {
  appendMessage,
  clearOutput,
  getRandomInt,
  shuffleArray,
  removeMenu,
  isInjured,
  injureCharacter
} from "./utilities.js";
import { simulationState } from "./simulationCore.js";
import { simulateKnockoutMatch } from "./tournament.js";
import { characterPics } from "./characterManager.js";
import { REL_THRESHOLDS } from "./characters.js";

/** ─── Helpers ───────────────────────────────────────────────────── */
function clampRel(a, b, d) {
  const r1 = window.getRelationship(a, b);
  r1.value = Math.min(100, Math.max(0, r1.value + d));
  r1.tier = window.getTierLabel(r1.value);
  r1.status = r1.tier;
  const r2 = window.getRelationship(b, a);
  r2.value = r1.value;
  r2.tier = r1.tier;
  r2.status = r1.status;
}

function clampAttr(c, attr, d) {
  if (c.fighting_attributes[attr] == null) return;
  c.fighting_attributes[attr] = Math.min(
    100,
    Math.max(0, c.fighting_attributes[attr] + d)
  );
}

/** ─── Champion‐driven Pairing Logic ────────────────────────────── */
function generateVillaPairings() {
  const chars = [...simulationState.currentCharacters];
  const pairs = [];
  const champ = simulationState.championOfDay;

  if (champ) {
    // Pick partner
    let partner = null;
    if (
      champ.name === simulationState.playerCharacter.name &&
      simulationState.playerVillaChoiceName
    ) {
      // Player chose partner
      partner = chars.find(c => c.name === simulationState.playerVillaChoiceName);
    } else {
      // NPC auto‐pick strongest relationship
      const others = chars.filter(c => c.name !== champ.name);
      partner = others.reduce((best, c) =>
        window.getRelationship(champ, c).value >
        window.getRelationship(champ, best).value
          ? c
          : best
      , others[0]);
    }
    if (partner) {
      pairs.push([champ, partner]);
      // Remove from list
      chars.splice(chars.findIndex(c => c.name === champ.name), 1);
      chars.splice(chars.findIndex(c => c.name === partner.name), 1);
    }
  }

  // Randomly pair the rest
  shuffleArray(chars);
  for (let i = 0; i < chars.length; i += 2) {
    pairs.push([chars[i], chars[i + 1] || null]);
  }
  simulationState.villaPairings = pairs;
}

function getVillaPartner() {
  const me = simulationState.playerCharacter.name;
  for (const [a, b] of simulationState.villaPairings) {
    if (a.name === me && b) return b;
    if (b && b.name === me) return a;
  }
  return null;
}

/** ─── NPC “Other Villa” Logic ─────────────────────────────────── */
function simulateNPCVillaInteractions() {
  const logs = [];
  const playerName = simulationState.playerCharacter.name;

  simulationState.villaPairings.forEach(pair => {
    let [p1, p2] = pair;
    if (!p2) return;

    // Ensure p1 is NPC if one is player
    if (p1.name === playerName) [p1, p2] = [p2, p1];

    // Skip if either is injured
    if (isInjured(p1) || isInjured(p2)) {
      if (isInjured(p1)) logs.push(`${p1.name} is injured and rests.`);
      if (isInjured(p2)) logs.push(`${p2.name} is injured and rests.`);
      return;
    }

    const acts = ["conversation", "intimate", "sabotage", "truthOrDare", "duel"];
    const act = acts[getRandomInt(0, acts.length - 1)];
    let msg = "";

    switch (act) {
      case "conversation": {
        const avgC =
          (p1.mental_attributes.craziness + p2.mental_attributes.craziness) / 2;
        const avgS =
          (p1.mental_attributes.stability + p2.mental_attributes.stability) / 2;
        const pBad = Math.max(0, Math.min(avgC / avgS - 0.8, 1));
        if (Math.random() < pBad) {
          const pen = getRandomInt(1, 2);
          clampRel(p1, p2, -pen);
          msg = `${p1.name} had a tense talk with ${p2.name}, both lost ${pen}.`;
        } else {
          const boost = getRandomInt(2, 4);
          clampRel(p1, p2, boost);
          msg = `${p1.name} shared a heart‐to‐heart with ${p2.name}, both +${boost}.`;
        }
        break;
      }
      case "intimate": {
        const rel = window.getRelationship(p1, p2).value;
        const pSucc = Math.max(
          0.2,
          Math.min(
            rel / 100 +
              p1.physical_attributes.seduction / 100 -
              p1.mental_attributes.jealousy / 100,
            0.9
          )
        );
        if (Math.random() < pSucc) {
          const boost = getRandomInt(5, 15);
          clampRel(p1, p2, boost);
          msg = `${p1.name} & ${p2.name} shared intimacy — +${boost}.`;
        } else {
          msg = `${p2.name} politely declined ${p1.name}'s advance.`;
        }
        break;
      }
      case "sabotage": {
        const chance =
          (p1.mental_attributes.cheating -
            p2.mental_attributes.loyalty +
            p2.mental_attributes.jealousy) /
          100;
        const ch = Math.max(0.2, Math.min(chance, 0.8));
        if (Math.random() < ch) {
          const attrs = ["strength", "technique", "stamina", "agility", "reflexes"];
          shuffleArray(attrs);
          const chosen = attrs.slice(0, 2);
          const details = chosen
            .map(a => {
              const loss = getRandomInt(5, 10);
              clampAttr(p2, a, -loss);
              return `${a}-${loss}`;
            })
            .join(" & ");
          msg = `${p1.name} sabotaged ${p2.name}, damaging ${details}.`;
          // 10% chance to injure
          if (Math.random() < 0.1) {
            injureCharacter(p2);
            msg += ` ${p2.name} got injured!`;
          }
        } else {
          const pen = getRandomInt(5, 10);
          clampRel(p1, p2, -pen);
          msg = `${p1.name}'s sabotage backfired — both lost ${pen}.`;
        }
        break;
      }
      case "truthOrDare": {
        if (Math.random() < 0.5) {
          const pT =
            p1.mental_attributes.loyalty /
            (p1.mental_attributes.loyalty + p1.mental_attributes.craziness);
          if (Math.random() < pT) {
            clampRel(p1, p2, 2);
            msg = `${p1.name} & ${p2.name} exchanged truths — both +2.`;
          } else {
            clampRel(p1, p2, -1);
            msg = `${p1.name}'s truth backfired — both -1.`;
          }
        } else {
          const pD =
            p1.mental_attributes.dominance /
            (p1.mental_attributes.dominance + p1.mental_attributes.stability);
          if (Math.random() < pD) {
            clampRel(p1, p2, 3);
            msg = `${p1.name} & ${p2.name} conquered a dare — both +3.`;
          } else {
            clampRel(p1, p2, -3);
            msg = `${p1.name} failed a dare — both -3.`;
          }
        }
        break;
      }
      case "duel": {
        if (isInjured(p1) || isInjured(p2)) {
          msg = `Duel canceled because ${
            isInjured(p1) ? p1.name : p2.name
          } is injured.`;
        } else {
          const res = simulateKnockoutMatch(
            p1,
            p2,
            simulationState.tournamentStyle
          );
          clampRel(
            res.winner,
            res.loser,
            res.winner === p1 ? 2 : -2
          );
          msg = `Midnight Duel: ${res.winner.name} d. ${res.loser.name} (${res.score}).`;
          // 20% chance loser gets injured
          if (!isInjured(res.loser) && Math.random() < 0.2) {
            injureCharacter(res.loser);
            msg += ` ${res.loser.name} got injured in the duel!`;
          }
        }
        break;
      }
    }

    // If partner was player, adjust wording
    if (pair.includes(simulationState.playerCharacter)) {
      const other = pair[0].name === playerName ? pair[1] : pair[0];
      msg = msg.replace(other.name, "you");
    }
    logs.push(msg);
  });

  return logs;
}

/** ─── UI Helpers ─────────────────────────────────────────────── */
function updateVillaActionResult(txt) {
  let d = document.getElementById("villaActionResult");
  if (!d) {
    d = document.createElement("div");
    d.id = "villaActionResult";
    document.getElementById("game-output").prepend(d);
  }
  const p = document.createElement("p");
  p.innerText = txt;
  d.appendChild(p);
}

function updateVillaAPDisplay() {
  let ap = document.getElementById("villaAP");
  if (ap) ap.remove();
  ap = document.createElement("div");
  ap.id = "villaAP";
  ap.className = "ap-display";
  ap.innerText = `Remaining AP: ${simulationState.villaAP}`;
  document.getElementById("game-output").appendChild(ap);

  const hdr = document.getElementById("apCounter");
  if (hdr) hdr.innerText = `Remaining AP: ${simulationState.villaAP}`;
}

/** ─── Player Actions ────────────────────────────────────────── */
function chatVilla() {
  if (simulationState.villaAP < 1) {
    alert("No AP");
    return;
  }
  simulationState.villaAP--;
  updateVillaAPDisplay();
  const p2 = simulationState.playerVillaPartner;
  if (isInjured(p2)) {
    updateVillaActionResult(`${p2.name} is injured and cannot chat.`);
    return;
  }
  const pos = Math.random() < 0.9;
  const amt = pos ? getRandomInt(1, 5) : -getRandomInt(1, 3);
  clampRel(simulationState.playerCharacter, p2, amt);
  updateVillaActionResult(
    pos
      ? `You chatted with ${p2.name}. (+${amt})`
      : `Awkward chat with ${p2.name}. (${amt})`
  );
}

function gossipVilla() {
  if (simulationState.villaAP < 1) {
    alert("No AP");
    return;
  }
  simulationState.villaAP--;
  updateVillaAPDisplay();
  const p2 = simulationState.playerVillaPartner;
  if (isInjured(p2)) {
    updateVillaActionResult(`${p2.name} is injured and cannot gossip.`);
    return;
  }
  const pos = Math.random() < 0.6;
  const amt = pos ? getRandomInt(6, 10) : -getRandomInt(2, 5);
  clampRel(simulationState.playerCharacter, p2, amt);
  updateVillaActionResult(
    pos
      ? `You gossiped with ${p2.name}. (+${amt})`
      : `Gossip backfired on ${p2.name}. (${amt})`
  );
}

function sabotageVilla() {
  if (simulationState.villaAP < 2) {
    alert("No AP");
    return;
  }
  simulationState.villaAP -= 2;
  updateVillaAPDisplay();
  const p2 = simulationState.playerVillaPartner;
  if (isInjured(p2)) {
    updateVillaActionResult(`${p2.name} is injured and cannot be sabotaged.`);
    return;
  }
  const p =
    (simulationState.playerCharacter.mental_attributes.cheating -
      p2.mental_attributes.loyalty +
      p2.mental_attributes.jealousy) /
    100;
  const ch = Math.max(0.2, Math.min(p, 0.8));

  if (Math.random() < ch) {
    const attrs = ["strength", "technique", "stamina", "agility", "reflexes"];
    shuffleArray(attrs);
    const chosen = attrs.slice(0, 2);
    const details = chosen
      .map(a => {
        const loss = getRandomInt(5, 10);
        clampAttr(p2, a, -loss);
        return `${a}-${loss}`;
      })
      .join(" & ");
    updateVillaActionResult(`Your sabotage on ${p2.name} succeeded: ${details}.`);
    // 10% chance to injure
    if (Math.random() < 0.1) {
      injureCharacter(p2);
      updateVillaActionResult(`${p2.name} got injured during sabotage!`);
    }
  } else {
    const pen = getRandomInt(15, 25);
    clampRel(simulationState.playerCharacter, p2, -pen);
    clampRel(p2, simulationState.playerCharacter, -pen);
    updateVillaActionResult(`Sabotage backfired — both lost ${pen}.`);
  }
}

function seduceVilla() {
  if (simulationState.villaAP < 1) {
    alert("No AP");
    return;
  }
  simulationState.villaAP--;
  updateVillaAPDisplay();
  const p2 = simulationState.playerVillaPartner;
  if (isInjured(p2)) {
    updateVillaActionResult(`${p2.name} is injured and cannot be seduced.`);
    return;
  }
  const relVal = window.getRelationship(simulationState.playerCharacter, p2).value;
  const relAB = relVal / 100;
  const sedA = simulationState.playerCharacter.fighting_attributes.seduction / 100 || 0;
  const flA = simulationState.playerCharacter.fighting_attributes.flirtiness / 100 || 0;
  const moB = p2.mental_attributes.monogamy / 100 || 0;
  const chA = simulationState.playerCharacter.mental_attributes.cheating / 100 || 0;

  let pSucc = (relAB + sedA + flA + moB + chA) / 5;
  if (relVal >= REL_THRESHOLDS.LOVER.min) {
    pSucc = Math.max(pSucc, 0.8);
  }

  const amt = getRandomInt(10, 15);
  if (Math.random() < pSucc) {
    clampRel(simulationState.playerCharacter, p2, amt);
    updateVillaActionResult(`Seduction succeeded with ${p2.name}. (+${amt})`);
    // 5% chance of minor injury
    if (Math.random() < 0.05) {
      injureCharacter(p2);
      updateVillaActionResult(`${p2.name} feels hurt during the moment and is injured.`);
    }
  } else {
    updateVillaActionResult(`${p2.name} politely refused your advance.`);
  }
}

/** ─── Menu & Flow ───────────────────────────────────────────── */
function displayVillaMenu(container) {
  removeMenu("villaMenu");
  const menu = document.createElement("div");
  menu.id = "villaMenu";
  menu.className = "modern-container ap-menu";

  updateVillaAPDisplay();

  [
    ["Chat", chatVilla],
    ["Gossip", gossipVilla],
    ["Sabotage", sabotageVilla],
    ["Seduce", seduceVilla]
  ].forEach(([label, fn]) => {
    const btn = document.createElement("button");
    btn.className = "modern-btn";
    btn.innerText = `${label} (${label === "Sabotage" ? 2 : 1} AP)`;
    btn.onclick = fn;
    menu.appendChild(btn);
  });

  const end = document.createElement("button");
  end.className = "modern-btn";
  end.innerText = "End Villa Night";
  end.onclick = finishVillaNight;
  menu.appendChild(end);

  container.appendChild(menu);
}

function finishVillaNight() {
  const logs = simulateNPCVillaInteractions();
  if (logs.length) {
    appendMessage("<strong>Other Villa Interactions:</strong>", "event-info");
    logs.forEach(l => appendMessage(l, "npc-interaction"));
  }
  appendMessage("The villa night ends.", "villa-end");
  const btn = document.createElement("button");
  btn.className = "modern-btn";
  btn.innerText = "Continue";
  btn.onclick = () => window.nextPeriod();
  document.getElementById("game-output").appendChild(btn);
}

/** ─── Entry Point ────────────────────────────────────────────── */
export function processVillaNight() {
  clearOutput();
  appendMessage(
    `<strong>Day ${simulationState.currentDay} - Villa Night</strong>`,
    "period-title"
  );

  const champ = simulationState.championOfDay;

  // 1) If player is champion and hasn't chosen, prompt partner pick
  if (
    champ &&
    champ.name === simulationState.playerCharacter.name &&
    !simulationState.playerVillaChoiceName
  ) {
    appendMessage(
      "You are the champion! Choose who to stay with in the villa tonight:",
      "event-info"
    );
    const div = document.createElement("div");
    div.id = "championChoiceDiv";
    simulationState.currentCharacters
      .filter(c => c.name !== champ.name)
      .forEach(c => {
        const label = document.createElement("label");
        label.style.display = "block";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "villaPartner";
        radio.value = c.name;
        label.appendChild(radio);
        label.appendChild(document.createTextNode(" " + c.name));
        div.appendChild(label);
      });
    const first = div.querySelector("input");
    if (first) first.checked = true;

    const btn = document.createElement("button");
    btn.className = "modern-btn";
    btn.innerText = "Confirm";
    btn.onclick = () => {
      const sel = document.querySelector("input[name='villaPartner']:checked");
      simulationState.playerVillaChoiceName = sel.value;
      removeMenu("championChoiceDiv");
      btn.remove();
      processVillaNight();
    };

    document.getElementById("game-output").appendChild(div);
    document.getElementById("game-output").appendChild(btn);
    return;
  }

  // 2) Generate pairings and display UI
  simulationState.villaAP = simulationState.config.villaAP || 5;
  generateVillaPairings();

  const container = document.createElement("div");
  container.id = "villaContainer";
  container.className = "pairings-container";
  const header = document.createElement("h4");
  header.innerText = "Pairs:";
  container.appendChild(header);

  simulationState.villaPairings.forEach(([a, b]) => {
    let text = b ? `${a.name} vs ${b.name}` : `${a.name} (bye)`;
    if (isInjured(a)) text += " (injured)";
    if (b && isInjured(b)) text += " (injured)";
    const p = document.createElement("p");
    p.innerText = text;
    container.appendChild(p);
  });

  document.getElementById("game-output").appendChild(container);

  simulationState.playerVillaPartner = getVillaPartner() || { name: "(none)" };
  displayVillaMenu(container);
}
