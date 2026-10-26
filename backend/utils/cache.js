import NodeCache from 'node-cache';

// PokeAPI data doesn't change, so entries never expire (stdTTL 0).
// useClones: false hands back the stored object instead of a deep copy; callers must not mutate it.
const cache = new NodeCache({ stdTTL: 0, useClones: false });

export default cache;
