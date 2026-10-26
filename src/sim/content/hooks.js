// Registered behaviour building blocks that data (and mods) can compose by id.
// The implementations live in ai/givers.js and ai/needs.js; this file only declares names and
// parameter schemas so content can be validated without loading the simulation.
import { obj, arr, num } from './schema.js';

export const GIVER_SPECS = {
  'core:gather_nodes': {
    doc: 'Offers resource nodes (trees, rocks, bushes, deposits) whose `workType` matches this work type, when the colony wants what they yield or the node blocks a site/field.',
    params: obj({ tag: { type: 'tag' } }),
  },
  'core:haul_stockpile': { doc: 'Moves loose items into the stockpile.', params: obj({}) },
  'core:haul_sites': { doc: 'Delivers materials to construction blueprints.', params: obj({}) },
  'core:construct': { doc: 'Builds blueprints whose materials have been delivered.', params: obj({}) },
  'core:sow': { doc: 'Plants seeds on empty field tiles.', params: obj({}) },
  'core:harvest': { doc: 'Harvests mature crops.', params: obj({}) },
  'core:trade_deliver': {
    doc: 'Carries goods promised in an agreed trade from this settlement to the other settlement stockpile. Ownership changes hands on delivery.',
    params: obj({}),
  },
  'core:bury': { doc: 'Carries the body of someone of the same settlement who died to the village graveyard and buries it (body and grave tile are reserved).', params: obj({}) },
  'core:tend': { doc: 'Feeds and tends colonists of the same settlement who have collapsed.', params: obj({}) },
  'core:maintain': { doc: 'Services buildings with a maintenance definition when worn below 60% (urgently when broken).', params: obj({}) },
  'core:refuel': { doc: 'Carries fuel (items with the generator fuel tag) into generators that are not full.', params: obj({}) },
  'core:rescue': { doc: 'Carries a collapsed colonist of the same settlement to a free medical bed (patient and bed are reserved, so only one rescuer goes).', params: obj({}) },
  'core:treat': { doc: 'Dresses wounds with bandages and treats infections with medicine (items tagged core:bandage / core:medicine, fetched from a cabinet or the stockpile); without supplies, cleans a wound once (first aid).', params: obj({}) },
  'core:teach': { doc: 'Teaches at a school desk during school hours when there are pupils, or instructs at a lectern when someone is training. Anyone may teach; teaching skill and a teacher qualification make lessons better.', params: obj({}) },
  'core:attend': { doc: 'Children whose life stage attends school go to a free school desk during school hours and learn (faster with a teacher present).', params: obj({}) },
  'core:train': { doc: 'The settlement\'s assigned trainee goes to a lecture bench during college hours and works toward a qualification.', params: obj({}) },
  'core:scout': { doc: 'When the settlement has not met a neighbouring village, one colonist (at most every two days) walks to the edge of that village so the two can meet.', params: obj({}) },
  'core:research': {
    doc: 'Researches the current technology of the colonist settlement at a free research station (fetching its material cost first).',
    params: obj({}),
  },
  'core:bills': {
    doc: 'Works production bills (recipes whose `workType` matches this work type) at a free station.',
    params: obj({}),
  },
};

export const NEED_BEHAVIOR_SPECS = {
  'core:eat': { doc: 'Find and eat food (prefers items tagged core:meal; respects seed reserves).' },
  'core:sleep': { doc: 'Sleep in own bed, any free bed, or on the ground. Uses bed.restRate.' },
  'core:shelter': { doc: 'Satisfied over time while the colonist has a completed home.' },
  'core:drink': { doc: 'Drink at a well (buildings with `water`) or from the shore of drinkable terrain. Untreated water can cause an upset stomach.' },
};

export const GOAL_PARAM_TYPES = ['int', 'item', 'workType'];

export const extraArr = (s) => arr(s);
export const ratio = () => num(0, 1);
