import { createClient } from '@supabase/supabase-js';

// 1. Initialize Supabase
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 2. Expanded target groups to pull massive biodiversity across land, air, and sea
const animalKingdomGroups = [
  // Mammals & Birds
  'Carnivora', 'Primate', 'Rodentia', 'Chiroptera', 'Cetartiodactyla', 'Perissodactyla', 'Passeriformes', 'Accipitriformes', 'Psittaciformes',
  // Reptiles & Amphibians
  'Squamata', 'Testudines', 'Anura', 'Caudata',
  // Fish & Marine Life
  'Actinopterygii', 'Chondrichthyes', 'Echinodermata', 'Cnidaria', 'Porifera',
  // Insects & Arachnids
  'Coleoptera', 'Lepidoptera', 'Hymenoptera', 'Diptera', 'Odonata', 'Araneae',
  // Molluscs & Crustaceans
  'Gastropoda', 'Bivalvia', 'Malacostraca', 'Annelida'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to fetch real academic papers from CrossRef API
async function fetchAndSavePapers(speciesId, scientificName) {
  try {
    const crossrefUrl = `https://api.crossref.org/works?query=${encodeURIComponent(scientificName)}&rows=3`;
    const response = await fetch(crossrefUrl, {
      headers: {
        'User-Agent': 'WildlifeDatabase/1.0 (mailto:research@wildlifedatabase.local)'
      }
    });

    if (!response.ok) return;

    const data = await response.json();
    const items = data.message?.items || [];

    for (const item of items) {
      const title = item.title?.[0];
      const journal = item['container-title']?.[0] || 'Scientific Journal';
      const year = item.published?.['date-parts']?.[0]?.[0] || null;
      const url = item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null);

      if (title && url) {
        // Check if paper already exists to prevent duplicate spamming
        const { data: existingPaper } = await supabase
          .from('literature')
          .select('id')
          .eq('species_id', speciesId)
          .eq('url', url)
          .maybeSingle();

        if (!existingPaper) {
          await supabase.from('literature').insert([{
            species_id: speciesId,
            title: title,
            journal: journal,
            year: year,
            url: url
          }]);
        }
      }
    }
  } catch (err) {
    console.warn(` ⚠️ Could not fetch literature for ${scientificName}`);
  }
}

async function importSpeciesForTerm(query) {
  const perPage = 200; // Increased batch size per request
  const maxPages = 5;  // Increased page depth to pull thousands of species

  console.log(`\n🔍 Deep scanning group: "${query}" for individual species and research papers...`);

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&rank=species&per_page=${perPage}&page=${page}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(` ⚠️ Rate limit hit. Backing off for 5 seconds...`);
          await delay(5000);
          continue;
        }
        throw new Error(`iNaturalist API error: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) break;

      let insertedCount = 0;

      for (const taxon of results) {
        const commonName = taxon.preferred_common_name || taxon.name;
        const scientificName = taxon.name;
        const imageUrl = taxon.default_photo?.medium_url || taxon.default_photo?.square_url || 'https://images.unsplash.com/photo-1534567153574-2b12153a87f0?auto=format&fit=crop&w=800&q=80'; // Fallback image so it never gets skipped
        
        const description = taxon.wikipedia_summary 
          ? taxon.wikipedia_summary 
          : `Comprehensive ecological profile for ${commonName} (${scientificName}). Member of the ${query} taxonomic group.`;

        // Accurate IUCN conservation status mapping
        let conservationStatus = 'Not Evaluated';
        if (taxon.conservation_status && taxon.conservation_status.status_name) {
          conservationStatus = taxon.conservation_status.status_name;
        } else if (Array.isArray(taxon.conservation_statuses) && taxon.conservation_statuses.length > 0) {
          const iucnRecord = taxon.conservation_statuses.find(s => s.authority === 'IUCN') || taxon.conservation_statuses[0];
          if (iucnRecord && iucnRecord.status_name) {
            conservationStatus = iucnRecord.status_name;
          }
        } else if (taxon.extinct) {
          conservationStatus = 'Extinct';
        }

        // True scientific family name extraction
        let familyName = query;
        if (taxon.ancestors && Array.isArray(taxon.ancestors)) {
          const familyObj = taxon.ancestors.find(a => a.rank === 'family');
          if (familyObj && familyObj.name) {
            familyName = familyObj.name;
          }
        }

        if (!commonName || !scientificName) {
          continue;
        }

        // Check if species already exists
        const { data: existing } = await supabase
          .from('species')
          .select('id')
          .eq('scientific_name', scientificName)
          .maybeSingle();

        let speciesId;

        if (existing) {
          speciesId = existing.id;
        } else {
          const speciesRecord = {
            common_name: commonName,
            scientific_name: scientificName,
            description: description,
            conservation_status: conservationStatus,
            family: familyName,
            image_url: imageUrl
          };

          const { data: insertedSpecies, error } = await supabase
            .from('species')
            .insert([speciesRecord])
            .select()
            .single();

          if (!error && insertedSpecies) {
            insertedCount++;
            speciesId = insertedSpecies.id;
          }
        }

        // Ensure literature is fetched even if the species record already existed
        if (speciesId) {
          await fetchAndSavePapers(speciesId, scientificName);
          await delay(150); // Respect CrossRef API guidelines
        }
      }

      console.log(` 📄 Page ${page}/${maxPages} for ${query}: Processed/Saved ${insertedCount} new species profiles with literature.`);
      await delay(1000);

    } catch (err) {
      console.error(`❌ Error fetching "${query}" on page ${page}:`, err.message);
      await delay(3000);
    }
  }
}

async function main() {
  for (const term of animalKingdomGroups) {
    await importSpeciesForTerm(term);
  }
  console.log('\n🎉 Comprehensive species and academic literature sync complete!');
}

main();