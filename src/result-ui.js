// Derive result visibility from every authoritative state, not only wins.
// A restart message can arrive before the new-round snapshot; old state must
// not leave the previous result overlay visible after that snapshot arrives.
export function setResultVisibility(element, winner) {
  element.hidden = !winner;
}
