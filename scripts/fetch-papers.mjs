import { createClient } from '@supabase/supabase-js';

// 1. Initialize Supabase from environment variables
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper: OpenAlex returns abstracts as an "inverted index" object.
// This helper reconstructs the full readable text string.
function decodeAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  const text = words.join(' ');
  return text.length > 350 ? text.slice(0, 350) + '...' : text;
}

// 2. Fetch papers for a single species
async function fetchPapersForSpecies(species) {
  console.log(`\n🔍 Searching OpenAlex for: ${species.common_name} (${species.scientific_name})...`);

  // Search OpenAlex works endpoint sorted by citation count
  const query = encodeURIComponent(`"${species.scientific_name}"`);
  const url = `https://api.openalex.org/works?filter=title_and_abstract.search:${query}&per_page=5&sort=cited_by_count:desc`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AnimalDatabaseProject/1.0 (mailto:your-email@example.com)' }
    });

    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status}`);
    }

    const data = await response.json();
    const works = data.results || [];

    if (works.length === 0) {
      console.log(`⚠️ No papers found for ${species.scientific_name}`);
      return;
    }

    console.log(` Found ${works.length} top papers.`);

    for (const work of works) {
      // Format clean DOI
      const rawDoi = work.doi || '';
      const cleanDoi = rawDoi.replace('https://doi.org/', '');

      // Extract primary authors (up to 4)
      const authors = work.authorships
        ?.slice(0, 4)
        .map((a) => a.author.display_name)
        .join(', ');

      // Extract publisher/journal name
      const journal = work.primary_location?.source?.display_name || 'Academic Journal';

      // Extract and decode paper summary
      const summary = decodeAbstract(work.abstract_inverted_index);

      const paperRecord = {
        species_id: species.id,
        title: work.title || work.display_name,
        authors: authors || 'Unknown Authors',
        journal: journal,
        publication_year: work.publication_year || null,
        doi: cleanDoi || null,
        url: work.doi || work.primary_location?.landing_page_url || null,
        summary: summary,
      };

      // Insert into Supabase papers table
      const { error } = await supabase.from('papers').insert([paperRecord]);

      if (error) {
        console.error(`   └─ Error inserting "${paperRecord.title.slice(0, 30)}...": ${error.message}`);
      } else {
        console.log(`   └─ Added: "${paperRecord.title.slice(0, 35)}..." (${paperRecord.publication_year})`);
      }
    }
  } catch (err) {
    console.error(`❌ Failed to fetch papers for ${species.scientific_name}:`, err.message);
  }
}

// 3. Main execution runner
async function main() {
  const { data: speciesList, error } = await supabase
    .from('species')
    .select('id, common_name, scientific_name');

  if (error) {
    console.error('Error fetching species from database:', error.message);
    return;
  }

  if (!speciesList || speciesList.length === 0) {
    console.log('No species found in database. Add at least one species in Supabase first!');
    return;
  }

  for (const species of speciesList) {
    await fetchPapersForSpecies(species);
  }

  console.log('\n Import finished! Refresh your website to view the papers.');
}

main();