import { createClient } from '@supabase/supabase-js';

// 1. Initialize Supabase
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 2. Define the animals or groups you want to auto-import
const searchTerms = [
  'Panthera',       // Big cats (Tiger, Lion, Jaguar...)
  'Ursidae',        // Bears (Grizzly, Polar Bear...)
  'Cetacea',        // Whales & Dolphins
  'Falconiformes',  // Eagles & Falcons
  'Primates',       // Gorillas, Chimps, Lemurs
  'Proboscidea'     // Elephants
];

async function importSpeciesForTerm(query) {
  console.log(`\n🔍 Searching iNaturalist for species matching: "${query}"...`);
  
  // Request 5 top species for each search group
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&rank=species&per_page=5`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`iNaturalist API error: ${response.status}`);

    const data = await response.json();
    const results = data.results || [];

    for (const taxon of results) {
      const commonName = taxon.preferred_common_name || taxon.name;
      const scientificName = taxon.name;
      const imageUrl = taxon.default_photo?.medium_url || taxon.default_photo?.square_url || null;

      // Check if species already exists to avoid duplicates
      const { data: existing } = await supabase
        .from('species')
        .select('id')
        .eq('scientific_name', scientificName)
        .maybeSingle();

      if (existing) {
        console.log(` ⏭️ Skipped: ${commonName} (${scientificName}) — already exists`);
        continue;
      }

      const speciesRecord = {
        common_name: commonName,
        scientific_name: scientificName,
        family: taxon.iconic_taxon_name || 'Animalia',
        conservation_status: taxon.conservation_status?.status_name || 'Least Concern',
        habitat_biome: taxon.iconic_taxon_name || 'Terrestrial',
        technical_notes: taxon.wikipedia_url ? `Wikipedia Reference: ${taxon.wikipedia_url}` : 'Imported via iNaturalist API.',
        image_url: imageUrl
      };

      const { error } = await supabase.from('species').insert([speciesRecord]);

      if (error) {
        console.error(` ❌ Failed to insert ${commonName}:`, error.message);
      } else {
        console.log(` ✨ Added: ${commonName} (${scientificName})`);
      }
    }
  } catch (err) {
    console.error(`❌ Error fetching "${query}":`, err.message);
  }
}

async function main() {
  for (const term of searchTerms) {
    await importSpeciesForTerm(term);
  }
  console.log('\n🎉 Species import complete!');
}

main();