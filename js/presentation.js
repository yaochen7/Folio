// Presentation details supplied with the approved Claude design.
const editions = {
  quiet: { tint:'#ff7a4d', blurb:'Eleanor inherits a house by the sea, and a silence she doesn’t yet know how to read. A gentle novel about rooms, tides and leaving things unfinished.' },
  atlas: { tint:'#f3cf8a', blurb:'A button on a pavement, a key without a door, a biscuit tin of buttons. Leo Hartwell maps the small objects that quietly hold a life together.' },
  blue: { tint:'#4d6dff', blurb:'Fifteen years after her mother’s death, Ada receives a letter in her handwriting, and returns to a harbour town that seems to have been expecting her.' },
  wild: { tint:'#4f9a6e', blurb:'Field notes from an unmarked path. June Calder on finding the wild in one small patch of ground, visited again and again until it knows you.' },
  slowly: { tint:'#f2a184', blurb:'A carefully planned journey falls apart on the first day. Nora Arden learns what travelling means when you take the long way round.' },
  tomorrow: { tint:'#6a8be0', blurb:'On a lunar station that borrows its sunrise, a green shoot appears that shouldn’t exist. Anya has to decide whether to record it.' }
};
export const collections = [
  { category:'Fiction', description:'Houses that wait, letters that shouldn’t arrive, a seed that cannot exist.', tone:'warm' },
  { category:'Ideas', description:'Essays and field notes on the things we almost overlook.', tone:'deep' },
  { category:'Escape', description:'One small bag, no return ticket, and the slowest routes there are.', tone:'blue' }
];
export function presentation(book) {
  const edition=editions[book.id];
  return { tint:edition?.tint||'#ff7a4d', blurb:edition?.blurb||book.description||'An original story from Folio.' };
}
