// Fictional Folio demo editions: the original covers and opening excerpts,
// followed by two newly written chapters per title. Page metadata describes
// the illustrative catalog edition; the reader paginates the actual prose.
const originalBooks = [
  {
    "id": "quiet",
    "title": "The Shape of Quiet",
    "author": "Mara Ellison",
    "genre": "Literary fiction",
    "kind": "shape",
    "kicker": "A novel",
    "cover": "The Shape<br>of Quiet",
    "pages": 248,
    "description": "When an architect inherits a house on a remote coastline, she discovers that the things left unsaid have shaped her life more than anything she has built. A tender story about belonging, beginnings, and the courage to be still.",
    "category": "Fiction",
    "chapters": [
      {
        "title": "A room of her own.",
        "paragraphs": [
          "The house had been waiting for her. She understood this before she saw it, before the road narrowed into a ribbon of pale gravel and the sea appeared between the trees.",
          "For eleven years, Eleanor had designed rooms for other people. Rooms full of light, rooms with a view, rooms that promised their owners a different kind of life. She had never once considered what a room might ask of her.",
          "Now, with a small brass key warm in her palm, she stood at the gate and listened to a silence that was anything but empty.",
          "A blue cup stood beside the kitchen window. There was no note, no explanation; only the cup and a small vase holding three dry stems. Her aunt had always believed that a room should contain something unfinished.",
          "Eleanor set her bag on the table. Outside, the tide was drawing a dark line across the sand. She wondered how many times she would have to watch it come and go before she stopped measuring the hours.",
          "She opened the window. For the first time in a long while, there was nothing she needed to improve.",
          "By morning, the house had begun to reveal its small instructions: the cupboard that opened with a lift rather than a pull, the floorboard that announced every visitor, the patch of sun that arrived on the wall precisely when the kettle boiled.",
          "She took her coffee outside and sat on the low stone step. There were things she would eventually need to decide. Letters to answer. A city to return to, or not.",
          "For now, there was the sea. And for now, she thought, the sea was enough."
        ]
      }
    ]
  },
  {
    "id": "atlas",
    "title": "Atlas of Small Things",
    "author": "Leo Hartwell",
    "genre": "Essays",
    "kind": "atlas",
    "kicker": "Notes on everyday wonder",
    "cover": "Atlas of<br>Small Things",
    "pages": 192,
    "description": "A collection of essays about the ordinary things we almost overlook. From the weight of a favourite cup to the geography of a familiar street, these pages invite a closer, more curious kind of attention.",
    "category": "Ideas",
    "chapters": [
      {
        "title": "A pocket-sized world.",
        "paragraphs": [
          "There is a drawer in every home that holds the beginnings of a museum. A key without a door. A smooth stone from a shore you can no longer name. A folded piece of paper that you have never quite decided to throw away.",
          "These are small things. They are also evidence. Of places we have been, people we have known, and versions of ourselves we have almost forgotten.",
          "This book began with a button.",
          "I found it on a pavement on a Tuesday. Blue, four holes, a thin white scratch across the face. Someone, somewhere, had a coat that no longer closed quite properly.",
          "I put it in my pocket. It was an absent-minded act, the sort of thing you do while thinking about something else. By the time I reached home, however, the button had become a question.",
          "How much of a life can fit inside a small thing?",
          "My grandmother kept her buttons in a biscuit tin. We would tip them onto the table and sort them by colour, then by size, then by rules we invented as we went.",
          "I know now that we were not sorting buttons. We were spending time together, and the buttons gave our hands something to do.",
          "The tin is in my drawer now. It is the largest small thing I own."
        ]
      }
    ]
  },
  {
    "id": "blue",
    "title": "The Blue Hour",
    "author": "Iris Vale",
    "genre": "Mystery",
    "kind": "blue-hour",
    "kicker": "A novel by",
    "cover": "The<br>Blue<br>Hour",
    "pages": 312,
    "description": "A coastal town. A single dark window. A letter that should never have arrived. Returning home after fifteen years, Ada discovers that some secrets have been waiting for exactly the right person to find them.",
    "category": "Fiction",
    "chapters": [
      {
        "title": "The last light.",
        "paragraphs": [
          "The town had a way of keeping its secrets in plain sight. They lived in the windows left open after rain, in the space between the church bells and the sea.",
          "When Ada returned that evening, every light along the harbour was on. Except one.",
          "She stopped beside the old post office and looked up at the house on the headland. Nothing had changed. That was the first thing that frightened her.",
          "The envelope had arrived three days earlier, addressed in a handwriting she recognised instantly. Her name, the old-fashioned way her mother used to write the capital A, the small hesitation before the final stroke.",
          "Her mother had been dead for fifteen years.",
          "Ada read the address once more, as though a different house number might make everything reasonable. Then she put the envelope back in her coat.",
          "A bell sounded behind her. The post office door opened, spilling a narrow rectangle of yellow light onto the wet street.",
          "“You came back,” a voice said.",
          "Ada turned. Mr Bell was older, smaller, but his eyes were exactly as she remembered. He looked past her towards the dark window on the hill. “We thought you might.”"
        ]
      }
    ]
  },
  {
    "id": "wild",
    "title": "Wild Enough",
    "author": "June Calder",
    "genre": "Nature",
    "kind": "wild",
    "kicker": "Field notes for a slower life",
    "cover": "Wild<br>Enough",
    "pages": 224,
    "description": "An invitation to step outside and pay attention. Following a year of walks close to home, June Calder traces the quiet ways the natural world can change how we see our own.",
    "category": "Ideas",
    "chapters": [
      {
        "title": "The unmarked path.",
        "paragraphs": [
          "The path was not on the map. It began where the pavement ended, a thin line in the grass that might have been made by a fox or a hundred pairs of ordinary shoes.",
          "I had lived beside it for seven years without following it. There was always somewhere else to be.",
          "That morning, I had nowhere to be until eleven. I stepped off the pavement.",
          "Within a minute, the sound of the road had changed. It was still there, but further away somehow, as though the trees had turned down a dial.",
          "A blackbird watched me from a gatepost. I watched it back. Neither of us seemed particularly impressed by the other.",
          "We stayed like that for a while.",
          "You do not need a mountain, I would discover. You do not need a forest, a coastline, or a carefully planned journey.",
          "You need a small patch of ground and a little time. You need to return, and return again, until the place begins to recognise you.",
          "The blackbird sang. I took that as a beginning."
        ]
      }
    ]
  },
  {
    "id": "slowly",
    "title": "Somewhere, Slowly",
    "author": "Nora Arden",
    "genre": "Travel memoir",
    "kind": "slowly",
    "kicker": "Taking the long way",
    "cover": "Somewhere,<br>Slowly",
    "pages": 276,
    "description": "With one small bag and no return ticket, Nora sets out to cross a continent by the slowest routes she can find. A warm memoir about getting lost, finding company, and learning to arrive.",
    "category": "Escape",
    "chapters": [
      {
        "title": "The next station.",
        "paragraphs": [
          "The train was late. This was, according to the woman sitting beside me, an excellent sign. “A train that arrives on time,” she said, “has not stopped to look at anything.”",
          "I had planned my journey in a notebook with a blue cover. Every connection, every platform, every hour carefully accounted for.",
          "By the end of the first day, the notebook was already wrong.",
          "She offered me a peach from a paper bag. We ate in companionable silence while the departure board shuffled its numbers overhead.",
          "I asked where she was going. She pointed down the tracks, then shrugged. “To see my sister. She knows I will arrive eventually.”",
          "There was a freedom in the word eventually that I had never considered before.",
          "When the train arrived, we found a carriage with a window that opened. The city slid away. A small white dog watched us from a garden. Someone, somewhere, was hanging out washing.",
          "I closed the notebook.",
          "For the first time on the journey, I began to feel that I was travelling."
        ]
      }
    ]
  },
  {
    "id": "tomorrow",
    "title": "A Place for Tomorrow",
    "author": "Theo Mercer",
    "genre": "Science fiction",
    "kind": "tomorrow",
    "kicker": "A novel",
    "cover": "A Place<br>for<br>Tomorrow",
    "pages": 340,
    "description": "On a station at the edge of a distant moon, a botanist receives a seed that cannot exist. A hopeful story about the worlds we inherit and the ones we choose to grow.",
    "category": "Fiction",
    "chapters": [
      {
        "title": "The borrowed sky.",
        "paragraphs": [
          "Every morning, the station borrowed a sunrise. It appeared on the eastern wall at six, warmed the glasshouse for fourteen minutes, and vanished behind the slow shadow of the moon.",
          "Anya had grown used to it. She had grown used to many things.",
          "What she had not grown used to was the small green shoot waiting on her desk.",
          "There was no label on the pot. No entry in the greenhouse records. The soil was dark, almost black, and smelled of something she knew but could not name.",
          "Rain, she thought eventually. Real rain, falling on warm ground.",
          "She had not smelled rain since she was nine.",
          "Outside the glass, the moon turned through its endless grey afternoon. Inside, the shoot had opened a second leaf.",
          "Anya checked the door, then the cameras. The station kept a record of everything that arrived and everything that left.",
          "For the first time, she considered not making an entry."
        ]
      }
    ]
  }
];

const continuations = {};

continuations.quiet = [
  {title: 'The room with no drawing.', paragraphs: `On the third morning, Eleanor found a door behind the coats. She had mistaken it for a cupboard because it occupied the sort of space she would have crossed out on a plan: too narrow for a useful room, too far from the windows. Its brass handle had been polished by years of use. When she turned it, a shallow flight of steps appeared, descending into a square of borrowed light.

The room below had a window after all. It looked directly onto the sea wall, so that the horizon was hidden and the water seemed to begin at the glass. A long table stood beneath it. On the table were three chipped bowls, a box of pencils, and a stack of envelopes held down with a stone. Nothing matched. Everything appeared to have been placed exactly where it was needed.

She was still examining the ceiling when someone knocked above her. The knock was followed by a voice asking whether she had found the bread. A woman in a yellow raincoat stood in the kitchen holding a paper bag. She introduced herself as Kit, from the house at the bend, then looked at Eleanor's bare feet. 'Your aunt said you never remembered slippers,' she said. 'I thought she was exaggerating.'

Kit set the bag down without asking where it belonged. They made tea. Eleanor learned that the boat painted green on the wall outside was called Mercy, that the woman who delivered the post sometimes left eggs, and that a storm was expected on Friday. She learned nothing about her aunt's final weeks. Kit seemed to understand that a person might need breakfast before being given the weight of another person's absence.

'What did she do downstairs?' Eleanor asked eventually. Kit buttered a slice of bread with particular care. 'Whatever people brought her.' There had been school application forms, broken radio cases, a wedding speech, a letter to a son in Canada. Ruth had possessed no official qualification for any of it. She had been good at sitting beside someone until a difficult thing became possible. The table, Kit explained, had been the important part.

After Kit left, Eleanor went down again. She opened the top envelope. It contained a drawing of the house made by a child: seven windows instead of five, a sun with eyelashes, a woman larger than the front door. Beneath it was a photograph of Eleanor at ten, holding a cardboard model. She remembered the model perfectly. She had forgotten that her aunt was the person behind the camera.

There were other things in the stack. A shopping list folded around a pressed flower. Instructions for resetting a boiler. A postcard on which someone had written only, I got there. Ruth had filed these objects by no system Eleanor could discover. They were not a record of achievement, exactly. They seemed to be a record of arrivals. Eleanor sat at the table and listened to water slapping against the far side of the wall.

Her phone rang. The office wanted a decision about the atrium. A supplier had changed the dimensions, and someone needed to say whether the new proportions were acceptable. Eleanor stood automatically, taking the call towards the light. On the screen, a drawing expanded beneath her thumb. Thin lines, exact figures, a space expressed entirely through what could be measured. She gave her answer. It was probably correct. It sounded, in the little room, strangely incomplete.

That afternoon she measured the house. The habit soothed her. She drew the kitchen first, then the hallway, then the stairs. At the bottom of the page she began the room below. The table would not fit her remembered dimensions. She checked again, moving a bowl so she could reach the wall. Behind it, pencil marks climbed the plaster. Names and dates, some rubbed almost away. Beside her own name was a line she had reached at twelve.

She put the measuring tape down. For a long time, she had believed that useful work began by identifying what a space lacked. Light. Storage. Circulation. She had made a career of finding the absence and supplying the answer. Here was a room with damp at the window, an awkward doorway, and barely enough clearance behind the chairs. Yet every object in it suggested that people had managed to become a little more themselves there.

When the rain started, she carried the drawings upstairs. She intended to finish them after supper, but instead she made soup from what she could find. There was too much. She stood with the full saucepan, uncertain, then found a container in the cupboard and wrote Kit on its lid. Outside, the yellow light at the bend appeared between the trees. The lane was dark enough that she took her aunt's old torch.

Kit opened the door before she knocked. Behind her, a radio played quietly. A chair had been pulled away from the table, and a spoon lay beside an empty bowl. Eleanor held out the soup. She had prepared a small explanation for why she had made so much, but Kit stepped aside, and the explanation became unnecessary. 'Come in,' she said. 'We were just about to eat.'`.split(/\n\n+/)},
  {title: 'What a house can hold.', paragraphs: `By Friday the sky had lowered until the sea and the air were nearly the same colour. Kit arrived after lunch with a stack of towels and instructions for the back door. The wind, she said, had an opinion about that door. Eleanor helped her carry the garden chairs inside. They tied the gate shut, checked the small drain at the foot of the steps, and watched a gull travelling sideways without appearing to move its wings.

Eleanor had intended to leave that afternoon. Her bag stood in the hallway, neatly closed. There was a train ticket on her phone and a message from the office asking when to expect her. She had spent the morning drafting an answer in which the practical details became more elaborate with every attempt. When the first roof slate struck the path, she deleted the message and wrote that she would call after the weather passed.

The electricity went at six. The house gave a soft mechanical sigh, and then the refrigerator stopped. Eleanor found candles in a drawer full of elastic bands. She set one in the kitchen and took another downstairs, protecting the flame with her hand. Water had begun to gather on the windowsill. It was not dramatic, only a fine line of moisture following a crack she had noticed and dismissed. She folded one of Kit's towels beneath it.

At eight someone hammered on the front door. It was a boy from the next lane, with a carrier holding a frightened cat. His grandmother's porch roof had come loose, and Kit had sent him ahead. He looked embarrassed about the cat, as if bringing it were a childish preference rather than a sensible act. Eleanor moved her packed bag off the hallway chair. 'Kitchen,' she told him. 'It's warmer there.'

His grandmother followed with Kit, both wet to the knees. After them came a man Eleanor recognised from the post office, carrying a kettle and explaining that his camping stove was reliable if nobody touched the red knob. The kitchen became crowded in an entirely unplanned way. Someone found mugs. Someone closed a rattling shutter. The cat refused the expensive folded blanket Eleanor offered and settled immediately inside the empty bread bag.

Eleanor discovered that she could help without being in charge. She fetched things, held a torch, listened to the man from the post office explain the roof. When she offered to sketch a repair, he asked her to wait until he had seen it in daylight. She waited. The permission surprised her. At work, the first person to offer an answer often became responsible for making every part of it come true. Here, a question could remain a question overnight.

They ate soup by candlelight. The boy's grandmother remembered Eleanor as a child who had collected smooth pieces of brick from the beach. Eleanor remembered the bricks but not the woman. This seemed to trouble neither of them. Kit told a story about Ruth getting locked outside in a dressing gown and borrowing a ladder from a man she had previously refused to speak to. There were details nobody agreed on. They laughed, and the house held the sound.

Later, while the others arranged themselves on sofas and spare beds, Eleanor went downstairs. She moved the envelopes away from the window. The small room was colder now, but the table was dry. She sat at it with a pencil and turned over her unfinished floor plan. On the blank side she drew a cup, badly. Then a bowl. Then the shape of the cat asleep in its paper bag. She had not drawn anything unnecessary in years.

Morning arrived without announcement. The wind had stopped. A branch lay across the gate, and the garden was full of things from other gardens. The sea looked exhausted. Eleanor made tea on the little stove while Kit walked home to check her windows. The boy woke first and asked whether he could have the drawing of the cat. She tore it carefully from the page. He studied it with the seriousness she usually encountered only in planning meetings.

When the electricity returned, her phone filled with messages. She read them at the kitchen table. There were decisions to make, and she made some of them. She arranged an extra week away, booked a roofer, and asked a colleague to take the atrium meeting. None of these decisions answered the larger question of what she would do with the house. For once, she did not consider the absence of a final answer a failure of preparation.

In the afternoon, she opened the window in the room below. Two centimetres, then four. Salt air moved over the bowls. On the back of the old drawing she wrote a list: repair the latch, ask Kit about the blue paint, buy more tea. Beneath that, after a pause, she added another line. Leave the table. It was the first instruction she had written for the house that did not require anything to be taken away.

Kit returned before dusk. She had brought the cat's empty carrier and a loaf still warm enough to soften the paper around it. Eleanor was standing at the gate with the broken branch in her arms. 'Train tomorrow?' Kit asked. Eleanor looked towards the kitchen window, where the blue cup caught the last of the light. 'Not tomorrow,' she said. Then she moved aside so they could both get through, and together they carried the bread inside.`.split(/\n\n+/)}
];

continuations.atlas = [
  {title: 'The geography of a cup.', paragraphs: `The oldest cup in my kitchen has a handle I can fit only two fingers through. This makes it inconvenient by the usual measures. Its glaze has faded near the rim, and a small brown crescent sits beneath the handle, where a crack was repaired before it came to me. The other cups are larger, easier to wash, and capable of surviving the dishwasher. I reach past them almost every morning.

I used to explain this by saying it had been my father's. People accept inheritance as an answer to peculiar behaviour. But he drank from it only for a few years, and not particularly ceremoniously. He carried it into the shed, left it on windowsills, and once used it to hold screws. If the cup possesses a dignity now, that dignity is something I have added. It did not come as part of the original purchase.

Look closely at an ordinary object and you begin to see how many descriptions can fit inside it. A cup is a small vessel for a warm drink. It is also clay, glaze, fuel, labour, a factory floor, a delivery route, a price somebody considered reasonable. Before it belonged to my father, it belonged to a shop. Before that, to a set of six. I have spent years caring about the final chapter while knowing almost nothing of the first.

One winter I turned it upside down and searched for its maker. The stamp was worn, but enough remained to identify a pottery that had closed before I was born. There was a photograph of the factory online: rows of windows, a chimney, three bicycles leaning against the wall. I enlarged the bicycles. This was not useful research. It did, however, make the cup feel less like a private relic and more like an intersection.

Someone had designed the curve of its handle. Someone had decided how much pigment to mix into the blue. Someone had inspected it, or failed to inspect it, before it was packed. Their work was still present in the particular way my fingers met its surface. I would never know their names. That did not make the relationship imaginary. We were touching different ends of the same long, practical decision.

The repair interested me most. A narrow seam ran through the brown crescent, too neat to be accidental. My father had not repaired it; he would have used the wrong glue and announced that the resulting lump was stronger. My mother could not remember the crack. 'It was always like that,' she said, which is one of the most reliable signs that a thing contains a history nobody thought to preserve.

For a while I considered having it restored properly. A specialist could match the colour, disguise the seam, return the handle to the convincing condition of having never been broken. I took photographs and wrote an email. Then I noticed that in every photograph my thumb rested on the brown crescent. The repair was where I held it. Removing the evidence of damage would not return an earlier cup to me. It would give me a different one.

There is a temptation, when writing about objects, to make every imperfection stand for courage. A chipped plate becomes a lesson in survival. A worn coat becomes an argument against waste. The cup is not trying to teach me anything. It is simply old, a little awkward, and still useful. I find this more comforting than symbolism. A thing need not become an example in order to earn its place in the cupboard.

Last spring, a friend broke a newer cup while helping with the washing. He held the handle in one hand and the body in the other, looking as though he had interrupted a very important arrangement. I told him it was fine. He did not believe me, so I showed him the blue one. We looked at the repair together. Neither of us proposed a metaphor. He swept the floor while I put the kettle on again.

The broken cup's handle stayed on the windowsill for three weeks. It resembled a small white bridge. I thought I might use it to hold a plant upright, then forgot the idea. One morning, while wiping down the sill, I put it in the bin. Nothing terrible happened. The room did not become less full of friendship because I had decided not to preserve every object that had passed through it.

An atlas selects. This is easy to forget. A map of a city cannot contain every conversation that happened on its streets, any more than my cupboard can hold every cup I have used. Keeping something is a way of choosing a scale. At one scale the blue cup is a family possession. At another it is a manufactured object. At another, a useful weight in the hand while a person stands still at the beginning of the day.

This morning I drank from it beside an open window. A van reversed in the street, sounding three short notes. Somebody had hung a green shirt on a balcony opposite. The tea grew cooler while I watched. When I carried the cup back to the kitchen, there was a ring of moisture on the sill. I wiped it away. The cup, empty now, was ready to go through its small geography again.`.split(/\n\n+/)},
  {title: 'An inventory of the almost invisible.', paragraphs: `At the back of my desk is a pencil too short to use comfortably. Its yellow paint has worn away where my fingers held it, and the eraser has hardened into something more likely to mark a page than clean it. I keep it because of a sentence written with it years ago. I can no longer remember the sentence. This seems, on reflection, an unnecessarily complicated arrangement between a person and a pencil.

The desk contains many such arrangements. A ticket from a journey whose return I remember more clearly than its departure. A paper clip holding nothing. A key labelled spare, without any indication of what it is spare to. These objects have survived several attempts to become better organised. Organisation, in my experience, is often a polite name for asking the past to take up less room while remaining available whenever we need it.

I once devoted a whole Saturday to this task. There were boxes labelled keep, give away, and decide later. The third box grew quickly. By lunchtime, it contained almost everything that could not be described without beginning with the words, This was from. I had created a filing system in which provenance outweighed purpose. At four o'clock I put the boxes away and used a clear corner of the desk to make a sandwich.

It was my neighbour's daughter who improved the system. She was helping me find a ruler for a school project when she discovered the little pencil. 'Why don't you use the end of another one?' she asked. She meant a pencil extender, a small metal sleeve into which the short piece could fit. The suggestion was so straightforward that I felt briefly foolish. I had spent years preserving an object instead of finding a way to use it.

We made an extender from a rolled sheet of paper and some tape. It was neither elegant nor durable. It worked. The pencil returned to the table, where it wrote measurements on scraps and arrows on plans. Its importance diminished almost immediately. Once a thing is back in use, it no longer has to carry the entire burden of being remembered. I was surprised to find how much that relieved me.

Not every object can return to its former work. The railway ticket no longer opens a gate. The old key may belong to a lock that has been replaced. Yet these things can sometimes find a smaller occupation. I use the ticket as a bookmark. It moves between books, bringing no useful information about trains but doing a decent job of marking a page. The key remains a mystery. I have stopped treating the mystery as an urgent administrative failure.

In the market near my home, a man sells single buttons from trays arranged by colour. I took my grandmother's tin to show him. He emptied a handful into his palm and identified three materials before I had finished explaining the tin's significance. To me they were memories; to him they were possibilities for repair. He found a match for a coat I had brought with me. The transaction cost less than my bus fare.

Watching him work, I understood something about the limits of private collections. An object can matter because of what happened to us around it, but it may also matter because of what it can still do for someone else. One of my grandmother's large brown buttons eventually went onto my neighbour's winter coat. I was pleased by the transfer. The button had not left the story. The story had acquired another address.

This is not an argument for empty rooms. I like a room with evidence in it: a book left open, a repaired chair, a bowl that has outlived the set it came from. But evidence need not become a barricade. There is a difference between keeping a path back to the past and requiring the present to walk around piles of it. I discover that difference slowly, and usually while looking for somewhere to put a mug.

Last weekend I opened the drawer again. I threw away three dried pens. I gave the spare ruler to the child next door. I put the little pencil, in its paper sleeve, beside the telephone. None of this felt like renewal in the grand sense. The desk remained a desk, complete with scratches and a tendency to collect receipts. I simply knew, a little more clearly, which things were still participating in the life of the room.

There is a place on a map where the symbols end and the blank page begins. It does not mean that nothing exists beyond the edge. It means that the map has finished the work it was made to do. I try to grant objects that same possibility. A thing may be loved, useful, lost, given away, or finished. Its final condition need not revise the value of everything that came before it.

Before closing the drawer, I found a smooth stone under a bundle of envelopes. I could not remember the shore. I put it in my pocket anyway and carried it on an afternoon walk. By the river, I set it on the low wall where somebody else might find it. Then I went home with an empty pocket, which turned out to be another small thing worth noticing.`.split(/\n\n+/)}
];

continuations.blue = [
  {title: 'The letter and the tide.', paragraphs: `Mr Bell held the post office door open with his shoulder. He had a parcel under one arm and a ring of keys in his hand. Ada had expected him to be surprised by the envelope. Instead he looked at her coat pocket, then at the weather, and asked whether she wanted tea. The ordinary invitation frightened her more than an explanation would have done. She followed him into the room behind the counter.

The kettle was the same one she remembered, a square metal thing with a loose lid. Beside it stood a new photograph of a woman she did not know. Mr Bell turned the photograph towards the wall before he sat down. Ada put the envelope between them. 'You sent this,' she said. He looked at the familiar handwriting without touching it. 'Yes.' He said nothing else until the kettle began to knock against its stand.

Inside was a single sheet. Her mother had written four lines. If the house is being sold, go to the room above the kitchen. The blue book is not an account of money. Ask who opened the gate. Below the words was a date from the summer before she died. Ada had read them so many times that the page had begun to soften at its creases. The instructions were precise. Their meaning was not.

'She gave it to me to keep,' Mr Bell said. 'Until the house changed hands.' The place on the headland, he explained, was going to auction. Its last tenant had died in the spring. The solicitor had put a notice in the window that morning. Ada looked towards the front of the shop. Between the jars of sweets she could see the pale rectangle of the notice reflected in the glass, as if it had been placed there for her.

She asked about the gate. Mr Bell moved a spoon from one side of his cup to the other. 'You'll want to see the book first.' She remembered this habit: the careful delay, the way adults in the town could send a child from person to person until a question lost its shape. 'I'm not twelve now,' she said. He met her eyes. 'No. And I should have told you before you were.'

He gave her a key but would not come with her. The path to the house had narrowed beneath the hedge. Rain tapped against her hood. At the front door she found the auction notice, a lock polished bright by use, and a small brass plate where somebody had removed a name. The key turned cleanly. Whatever the house had been keeping, it had not been allowed to fall into complete neglect.

The room above the kitchen contained a narrow bed and a desk facing the harbour. On the desk was an electricity bill, folded into quarters. The blue book stood between a dictionary and a manual for an engine no longer made. Ada recognised her mother's careful labels on its spine. She had expected a diary. Instead, page after page listed times, weather, boat names, and short groups of initials written in different hands.

The night of the flood occupied six pages. Ada knew the public account: a sudden surge, the south wall breached, a town evacuated in time because the harbourmaster had raised the alarm. There was a plaque about it by the library. In the book, beside the earliest time, her mother's initials appeared twice. A note beneath them read: Gate still shut. Water at lower stairs. Bell informed. Then a line had been scratched out so firmly it had cut through the page.

Ada held the paper towards the window. She could make out only a number and the last two letters of a name. On the next page, a different hand had recorded the gate opening at eleven forty-three. By then, according to the plaque, the evacuation had already begun. The difference was forty-six minutes. She copied the figures into her phone, then found a small square of paper tucked beneath the book's cloth cover.

It was a photograph of the kitchen below. Her mother stood by the stove with her sleeves rolled up. Three children slept at the table. A fourth sat on the floor, holding a toy boat. Ada recognised herself immediately, though she had no memory of being there. The boy beside her was Mr Bell's grandson, Peter. For years she had believed that Peter had spent the flood night with relatives inland. Someone had told her so. She could not remember who.

Downstairs, a floorboard creaked. Ada switched off her phone's light. Through the open doorway she heard a key move against the front lock, followed by the soft pressure of a shoulder on wood. 'Mr Bell?' she called. The house remained silent. Then came the sound of footsteps retreating along the path. By the time she reached the door, there was nobody outside. A white envelope lay on the mat, damp along one edge.

Inside it was a second photograph. The south gate, open against black water. Her mother standing on the narrow bridge above it. On the back, in an unfamiliar hand, someone had written a time: 10.57. Ada looked out at the dark upper window reflected in the glass of the door. The first letter had asked a question. Someone in the town, at last, had decided to let her see the answer.`.split(/\n\n+/)},
  {title: 'A window left alight.', paragraphs: `She found Peter Bell on the harbour steps at seven the next morning. He was mending a net, though no boat waited for it. His hair had gone grey at the temples. Ada knew him by the way he held his head, slightly tilted, as if listening to someone behind him. She sat two steps above him and placed the photograph on the stone. He looked at it for a long time before putting down his needle.

'You left this,' she said. He nodded. 'Why not knock?' He gave a small, embarrassed smile. 'I tried. Then I remembered how good this family is at talking.' They watched a fishing boat turn slowly at the end of the pier. Peter told her he had found the photographs among his father's things. His father had been the deputy harbourmaster, the man whose name appeared on the plaque beside the library.

The official gate had failed, he said. Its mechanism had jammed with debris hours before the surge. There was a manual release on the bridge, reachable only from the headland path. Her mother had known because she had spent that summer copying the old operating instructions for the harbour office. She had gone up alone. By the time the harbourmaster's radio message arrived, the water was already beginning to move through the open channel.

'Then why didn't anyone say?' Ada asked. Peter rubbed his thumb along the edge of the photograph. His father had given a mistaken time in his first report. It was a small error, made in confusion. Later, when a newspaper called him a hero, correcting it became harder. Then a ceremony was planned. Then a plaque. Each retelling made the space for the truth smaller. Peter had been eleven. He had learned the story the same way Ada had.

Ada stood up. The explanation was ordinary enough to be unbearable. She had expected one decisive lie, something she could point to and condemn. Instead there had been many small failures, each leaning against the one before it. Her mother had continued to live in the town for a year after the flood. People had bought vegetables beside her, asked after her family, borrowed books from her desk. All that time, her name had been missing from the story.

Mr Bell was waiting in the post office. Ada showed him both photographs and the copied ledger. He did not ask where she had found them. 'I knew she went up the path,' he said. 'I didn't know the time until later.' His voice was steady until he described seeing the children in the kitchen. He had been so grateful to find Peter alive that gratitude had become an excuse for not looking at anything else.

'She didn't ask for a ceremony,' he said. Ada heard how often he must have told himself this. 'She asked you to keep a letter.' He nodded. On the shelf behind him, the photograph still faced the wall. It showed his son in uniform at the dedication of the plaque. Ada turned it around. Nothing could be repaired by pretending that the people involved had been simple, or that loving them had never complicated the truth.

They went to the house together. This time Peter came too. Mr Bell unlocked a cupboard beneath the stairs and took out the radio log, wrapped in a clean towel. The scratched-out name in the blue book was not her mother's. It was his son's: the first mistaken entry, corrected after midnight and then copied wrongly into the summary. There was no missing confession. There were records, incomplete and human, that someone needed to read together.

For two afternoons, they worked at the kitchen table. Ada compared the entries. Peter found a woman who remembered carrying blankets up the path. Mr Bell wrote down what he had seen, crossing out any sentence that began with he must have. Ada's mother emerged from these accounts as a person doing a difficult thing with practical determination. She had borrowed boots, complained about the torch, and told someone to keep an eye on the kettle.

On the third morning, Ada took the folder to the library. The librarian read it without interruption. They agreed on an exhibition of the flood records, with names attached only to actions the documents supported. A new plaque would take discussion. The exhibition could begin next week. Ada left with a list of tasks and the unexpected relief of having something smaller than vindication to do. She needed mounts, captions, and a good copy of the photograph.

That evening she returned to the house. The auction notice still stood in the window. She could not save every room in which her mother had once been, and she was beginning to understand that she did not need to. Before leaving, she placed the blue book in a protective folder and wrote the library's address on it. Then she checked the upper window. The bulb was sound. The switch had simply been left off.

From the post office, the lit window looked very small. Ada stood beside Mr Bell beneath the awning while rain began again. They had not forgiven each other for everything; perhaps they had not even agreed on everything. But the folder was ready, and tomorrow they would carry it down the road together. Above the harbour, the house no longer disappeared into the headland. One square of light marked the place where the story had begun to change.`.split(/\n\n+/)}
];

continuations.wild = [
  {title: 'The practice of returning.', paragraphs: `I went back the following Thursday, wearing shoes that were entirely wrong for mud. This is the first useful thing to know about a habit: it does not usually arrive with appropriate equipment. I had seventeen minutes before a call, a coat with a broken zip, and the unreasonable feeling that a walk counted only if it took me somewhere new. The unmarked path offered none of the qualifications I thought I needed.

The blackbird was absent. In its place, a crisp packet had caught in the hedge. I picked it up because it was close enough to reach without stepping into the ditch. Beneath it lay a strip of yellow grass and the small, pale shell of a snail. I had expected a repeat of my first morning's discovery. Instead, I found the less theatrical business of a place continuing while I was elsewhere.

At the bend, a man in a red cap was fastening a loose wire to a gate. He asked whether I was looking for the playing field. When I said I was only walking, he nodded as if that were a proper destination. His name was Ellis. He had been using the path since before the estate was built. According to him, the hedge had once divided two orchards. He pointed towards a row of garages where the second orchard would have stood.

I asked what sort of trees had grown there. 'Apples, mostly. One terrible pear.' He laughed at the pear with the affection people sometimes reserve for an inconvenience that has outlived its ability to bother them. I had walked past the garages for years without imagining anything beneath them. Now a small, stubborn orchard occupied the same space. It would never appear on a current map, but it changed the way I looked through the fence.

For several weeks I kept a notebook. The first entries were embarrassingly ambitious: weather, route, species, mood. I had given myself a form to complete. On the fourth walk I could identify nothing beyond grass and something yellow. On the fifth I left the notebook at home. On the sixth I took it again and wrote, There are three different kinds of quiet between the gate and the bridge. This was less scientific and much more accurate.

There was the quiet close to the road, which contained the road. There was the quiet under the old hedge, where footsteps seemed louder than they should. And there was the quiet at the bridge, interrupted by water passing through a pipe. None was silence. I began to notice that I had been using the word quiet to describe places where my own thoughts no longer had the loudest voice.

The path was short enough that I could learn its ordinary arrangements. A root crossed the ground just before the second gate. A low branch gathered drops after rain. An abandoned football shifted between the ditch and the bank without anyone appearing to move it. Knowing where these things were did not make the walk less interesting. It gave me a way to notice what had changed: the branch cut back, the root newly exposed, the football finally gone.

Once, after a difficult morning, I walked the whole distance without seeing anything at all. I remember this because I was annoyed with myself afterwards. I had come looking for the sort of attention I was beginning to associate with the path, and instead I had rehearsed a conversation I could not improve. The hedge did not cure this. The water did not supply advice. I got home muddy and still worried, which was a perfectly possible outcome of going outside.

The next day, I returned anyway. Ellis was at the gate with a bag of cable ties. He pointed to a patch of bare soil where something had been digging. Neither of us could say what. We spent several minutes considering it, then admitted that we were guessing. I liked him more for this. I had assumed that knowing a place meant being able to name everything in it. Here was someone who had known the path for forty years and could still look puzzled.

By early summer, the grass leaned across the narrow track. I brushed it with my coat and carried small dark seeds home in the cuffs. I had learned a few names, enough to replace something yellow with buttercup in the notebook, but many pages remained uncertain. I stopped apologising for them. A name could sharpen attention; it could also become an excuse to stop looking once the answer had been supplied.

One evening I took a friend along. At the bridge, she asked where the good part was. I understood the question immediately. I had asked it of cities, museums, and weekends, always assuming that somewhere ahead there would be an experience that justified the effort of arriving. I pointed towards the pipe, the hedge, the patch of water reflecting a slice of sky. 'This is the part I've been coming to,' I said.

She did not pretend to be astonished. We stood for a while, then walked home through the garages. I told her about the orchard and the terrible pear. She stopped beside a crack in the concrete where a small tree had appeared. We could not identify it. It was only as tall as her hand, with four clean leaves. She took a photograph. I did not write anything in the notebook that evening. There was nothing I needed to add.`.split(/\n\n+/)},
  {title: 'A little ground in winter.', paragraphs: `In November, a fence appeared across the path. It was a temporary barrier, orange plastic stretched between metal poles, with a notice attached so low that rain had collected inside its cover. The wording explained that the bank near the bridge needed repair. There was no date for reopening. I stood in front of it with a disappointment that seemed out of proportion to the loss of four hundred metres of uneven ground.

For the first time, I walked the road around the back of the estate instead. It was louder, straighter, and easier underfoot. At the corner shop, I found Ellis buying milk. He had seen the fence too. 'Bank's been giving way for years,' he said. He did not sound offended on the path's behalf. I was grateful for this. Liking a place did not require believing it should remain exactly as I first encountered it.

The detour took me past a patch of rough ground behind the bus stop. I had usually regarded it as the uninteresting space between two more important places. There were broken bricks, a drain cover, and a narrow strip of soil where the pavement ended. After three mornings of passing slowly, I noticed how the low winter light caught on the grass there. After five, I noticed a woman who came out of the flats to refill a shallow dish with water.

She told me her name was Priya. The dish had belonged to a flowerpot until a delivery van drove over the pot and left the saucer behind. She had kept it because water gathered in it anyway. We watched a small brown bird land beside it, drink, and leave before either of us could decide what to call it. 'They know what they are,' she said. I wrote that down when I got home.

Winter changed the scale at which I could see. Without leaves, the hedge along the road revealed a complicated structure of branches, wire, and things caught by the wind. A glove hung by one finger. Two old nests rested close enough together to make me wonder how often their occupants had disagreed. The sky seemed larger, but the interesting details were smaller: a drop at the end of a twig, the exact shape of a bud closed against the cold.

I began carrying a cloth bag for litter. On some days I filled it; on others I forgot it altogether. I mention this because it would be easy to turn a small preference into a declaration of purpose. I was not conducting a campaign. I was walking to the shops and picking up what I could reach. The bag made the work ordinary enough to continue, which was more useful than making it impressive.

In December, the council put up a second notice. There would be a morning of clearing and planting near the repaired bank. I imagined a group of capable people in matching outdoor clothes and nearly decided not to go. When I arrived, the first person I saw was a man wearing office trousers beneath waterproof leggings. A child carried a spade almost as tall as she was. Ellis had brought biscuits in the tin he used for screws.

We were given small tasks and shown where not to step. I worked beside Priya, lifting pieces of plastic from the edge of the ditch. The ground was colder than I expected. After half an hour, I could no longer feel the elegance of my intentions, only the awkward shape of the thing caught around a root. Priya held the bag open. Between us, we freed it. The root remained where it belonged. It was a modest achievement and an entirely satisfying one.

Later, someone asked how long I had known the path. 'Since spring,' I said. It sounded like no time at all. Around me were people who had used it for school journeys, dog walks, and years of taking the long way home. I had arrived late to a place that had been sustaining ordinary lives without requiring my discovery. This did not diminish my attachment. It gave the attachment neighbours.

The fence came down in January. There was a new rail at the bridge and a pale strip of gravel along the repaired bank. At first, the changes looked too clean. Then rain darkened the timber, footprints softened the gravel, and a leaf caught in the same corner where the old football used to rest. Familiarity began again. I had thought of returning as a way of holding a place still. The path taught me otherwise by continuing to change.

On the first clear morning after the reopening, I saw the blackbird on the gatepost. Or a blackbird. I could not honestly claim to know the difference. It tilted its head, considered the ground, and disappeared beneath the hedge. The whole encounter lasted less than a minute. I stood with my hands in my pockets while the road went on making its road noises behind me. There was no grand arrival, only the small pleasure of being there in time.

I still walk elsewhere. I like a hill, a coast, the unreasonable width of a view from somewhere high. But when somebody asks where I go to find a little wildness, I think first of the gate beside the estate, the repaired rail, and the dish behind the bus stop. Enough does not describe how little a place contains. It describes the point at which I have begun to give it room in my day.`.split(/\n\n+/)}
];

continuations.slowly = [
  {title: 'A town between connections.', paragraphs: `The woman with the peaches was called Elena. I learned this only after sharing a compartment with her for three hours, by which time she knew the contents of my bag, my preferred side of the train, and the fact that I was recently unemployed in a way I kept describing as taking a break. She did not correct the description. She simply handed me another peach and asked whether the break was going well.

At a station with blue benches, the conductor announced that a fallen tree had closed the line ahead. Everyone would need to get off. I immediately opened the notebook. There was a bus at four, a connection at six, and a night train that might still be possible if the bus arrived exactly when the timetable suggested. Elena watched my finger travel down the page. 'Have you been to this town?' she asked. I admitted that I had not looked at its name.

It was called Roven. The station had one platform, a clock showing two different minutes depending on which side you approached, and a café that was closed until the following morning. A young man in a conductor's jacket wheeled a bicycle past us and explained where the replacement bus would stop. It would be here eventually, he said. Elena looked at me with the mild satisfaction of a person whose favourite word had received official support.

We left our bags with the station attendant and walked towards the square. I was anxious about leaving the notebook out of sight, though it contained nothing anybody else could use. Beyond the station lay a lane of low houses, a fountain without water, and a shop selling lightbulbs beside jars of honey. Elena bought bread. I bought a postcard because buying one felt like evidence that I had made use of an unscheduled place.

At the edge of the square, a woman was trying to hang a painted sign above a door while standing on a chair too short for the task. Elena held the chair. I held the sign. The woman gave instructions in a language I knew badly and then in gestures I understood much better. When we were finished, the sign sat at a slight angle. She inspected it, shrugged, and invited us in for coffee.

The room was full of books. Not a shop, the woman explained, but a reading room run by people in the town. The shelves had been built from mismatched boards, and every book carried a small card with the name of its donor. Her name was Mira. She showed us a table someone had repaired that morning, a cupboard that refused to close, and a box of children's books still waiting to be sorted. She spoke of the room as if it were a person taking its first uncertain steps.

I asked whether there was anything I could do. It was a question I had not expected to ask on this journey. My former work involved organising things for people who were generally displeased by how much organisation was required. Mira gave me a stack of blank cards and showed me the ledger. For the next hour, I wrote names and titles while Elena shelved books. Nobody called it a transferable skill. It was simply work that needed doing.

At three, the station attendant appeared in the doorway carrying my bag. He had heard where we were from the woman at the honey shop. The bus was delayed again. Elena's sister had telephoned to say she would collect her from the junction that evening. I could still travel onwards, he said, or the inn opposite the square had a room. He gave me this information without the urgency I would normally have supplied myself.

I went outside to think. The square was quiet enough that I could hear someone setting plates on a table behind an open window. My notebook presented two alternatives: a complicated night of waiting in unfamiliar stations, or an empty space where the day's route had ended. For years I had treated an empty space as a flaw to be corrected. I stood beside the dry fountain and wondered what it might be like to let one remain.

The inn's room had a narrow bed and a view of the reading room's newly hung sign. I took off my shoes. On the back of the postcard I wrote to my father that I was in Roven, a town he would not find on the route I had sent him. I expected to feel guilty about this. Instead I felt unexpectedly accurate. For the first time since leaving, my message described where I was, rather than where I was supposed to have been.

Elena left at six. Her sister turned out to be shorter, brisker, and carrying the same sort of paper bag. They stood beside each other examining me as though deciding whether I required further provisions. I received two tomatoes, directions to a bakery I would not pass, and an invitation with no fixed date. Elena put her hand briefly over the blue notebook. 'Keep it,' she said. 'It seems to make you happy when you are not listening to it.'

That evening Mira opened the reading room for the first time. Six people came, then nine, then a boy who wanted to know whether books about engines counted. We found him three. When I finally crossed the square to the inn, the sign glowed beneath a small lamp. I could see, from my window, the angle at which we had hung it. I had no photograph of the work we had done. I slept very well.`.split(/\n\n+/)},
  {title: 'Arriving without a finish line.', paragraphs: `I stayed in Roven for two nights. On the second morning I went to the station and bought a ticket for a train that left after lunch. Buying it felt different from drawing the journey in the notebook. There was a departure I could prepare for, a destination I could reach, and several hours that had not yet been assigned a purpose. I used them to carry a box of books from Mira's kitchen to the reading room.

The train took me through a valley where sheets hung between houses so close to the line that I could see the patches sewn into them. I began noticing repair everywhere. A wall supported by new timber. A seat cushion with a careful square stitched over a tear. My old itinerary had been an attempt to make travel smooth. The actual journey was full of seams, and the seams were often where another person's care became visible.

At the junction, I missed my connection by four minutes. This is the point in a travel story where the narrator is usually expected to demonstrate a changed character. I did not. I was tired, hungry, and briefly furious with a clock. I bought an excessively expensive sandwich and ate it while looking at the departure board. Then I found the next train. Learning to tolerate uncertainty had not made every uncertain moment pleasant. It had merely prevented one of them from swallowing the whole day.

By the coast, the light became flatter and the stations smelled of salt and warm rails. I had chosen the last town on the line because the map made it look like an ending. Its name was Valeira. I imagined a harbour, a small hotel, perhaps a bench from which I would understand something decisive about my life. Instead I arrived in heavy rain, found roadworks outside the station, and discovered that the hotel in my notebook had become an accountancy office.

The accountant let me use his telephone to call another hotel. He did this while finishing a conversation about a printer, which gave the gesture a welcome lack of ceremony. The new place was above a bakery. My room smelled faintly of yeast. I spread the wet map on the desk and looked at the blue line I had followed across it. It was long enough to seem impressive and thin enough to conceal almost everything that had mattered.

I called my father. He asked whether I had reached the end. 'The end of the railway,' I said. 'Does that count?' He laughed, and I realised how often I had mistaken his questions for requests to justify myself. He told me about a loose paving stone outside his house, a neighbour's new dog, and the soup he had made badly enough to require a second attempt. I told him about the sign in Roven. He wanted to know how we had fixed it to the wall.

We talked for forty minutes. Nothing was resolved about my work, my money, or what I would do when I returned. Yet after the call, the room felt less temporary. I had spent much of the journey trying to become a person with a story worth reporting. My father had been interested in the screws. I found this a relief. It was possible to be present in another person's life without first arriving at a conclusion.

The following morning I walked to the harbour. A ferry crossed the mouth of the bay, carrying people to a village visible from the quay. I bought a ticket because it was going there and because I wanted to feel the water moving beneath my feet. There was no special attraction in the village. A woman sold oranges from a table. A dog slept under the table. I sat on a low wall and ate an orange while the ferry returned to the opposite shore.

I thought about Elena and her sister, who had not required punctuality in order to be expecting each other. I thought about Mira, opening the reading room on the evening it was ready enough. I thought about my father waiting to hear what sort of screws we had used. The journey had not taught me to abandon plans. It had shown me how much life continued at the edges of a plan, available whenever I stopped treating the edge as a mistake.

That afternoon I opened the notebook to a clean page. I wrote down the train home. Then, beneath it, I wrote three addresses: Elena's, Mira's, my father's. I left a fourth line empty. Not as a symbol, and not because an empty line possesses any particular wisdom. I simply did not yet know whether there would be another address to add. There was enough room on the page to wait until I did.

On my last evening, the baker brought a misshapen loaf upstairs. It could not be sold, she said, because one side had opened too far in the oven. We ate it at the little table by the window with cheese from a paper wrapper. She asked where I had been. I gave the route, then stopped and began again with Roven. The second version was less efficient. It was also the one she stayed to hear.

My return ticket lived in the blue notebook all the way to the station. I arrived early enough to buy coffee and late enough not to reorganise the day around waiting. When the train pulled in, a woman beside me asked whether it usually ran on time. I said I did not know. We boarded together, found seats facing the water, and watched the platform begin to move. There was, for the moment, nothing else either of us needed to do.`.split(/\n\n+/)}
];

continuations.tomorrow = [
  {title: 'An unregistered green.', paragraphs: `Anya did not hide the plant. She moved it into an empty propagation box, closed the lid, and wrote the time on a piece of tape. It was an old habit, learned from a supervisor who believed that uncertainty should always arrive with a timestamp. Then she stood beside the box and considered the station's entry form. Every living thing required a source code. Without one, the form would not allow her to finish the first line.

She entered unknown. The word turned red. She entered pending. The word disappeared. Outside the glasshouse, a maintenance trolley passed with one wheel making a familiar complaint. Someone laughed in the corridor. The station was continuing its day while a small green exception unfolded on her desk. Anya took a photograph, saved it with the time, and called the duty officer. She was surprised to discover how difficult it was to say simply that she had found a plant.

The duty officer was Deren, an engineer who could make almost any problem sound like a valve. He arrived carrying an air sampler and a mug. When he saw the shoot, he set the mug down very carefully. 'Where from?' he asked. Anya pointed at the desk. 'Before that?' She shook her head. He checked the box's seal, read the tape, and looked towards the cameras. 'Then the first job is finding the missing bit of the journey.'

The camera showed an empty desk at five forty-one. At five forty-seven, the station's cleaning unit passed between the desk and the lens. When it moved away, the pot was there. Anya watched the interval four times. The cleaning unit had no arms capable of lifting the pot. Its collection compartment was not large enough to contain it. Somewhere in the six-minute gap, another route had intersected the one the camera could see.

Deren took her to the service corridor behind the glasshouse. Three access panels opened onto a narrow shelf beneath the window. One of them had been unlatched for a cable repair. A person could have reached the desk from the shelf without crossing the door sensor. The possibility was almost disappointing. Anya had spent twenty minutes imagining failures in the station's surveillance. The actual gap was an engineer forgetting to close a cupboard.

The repair team had three members. Two were asleep after a long shift. The third was Lio, a young systems technician who listened to the question without pretending to misunderstand it. 'I put it there,' he said. 'I thought you'd know what to do.' He had intended to leave a note, then heard someone coming and lost his nerve. Anya asked where he had found it. He looked at Deren before answering. 'My grandmother's storage case.'

Lio brought the case to the glasshouse. It was a small metal container with the name of an old transport vessel stamped into its side. Inside were folded clothes, a paper photograph, and six sealed packets. Five held only dark dust. The sixth lay open. His grandmother had died before the station's last supply rotation. Among her instructions was a request to plant one seed when he found a place that intended to remain somewhere.

'I didn't know what that meant,' he said. He had kept the packets for a year. Then the station announced that its operational lease would be extended for another decade. He found a pot, took soil from a disposal tray, and waited. The shoot appeared after eleven days. He had expected an ordinary herb, something his grandmother might have grown in a kitchen. Instead the second leaf opened with a silver seam that neither of them had seen outside old photographs.

Anya searched the historical archive. The plant's common name was rainflower. There were drawings, a few damaged recordings, and a note saying that no viable collection was known to have left the southern evacuation zone. She had been nine when those ships departed. In one recording, a woman shook water from a branch and laughed at someone behind the camera. The leaves moved like the shoot's leaves, each silver seam briefly catching the light.

She could not confirm the identity from two leaves. She said this twice, once to Lio and once to herself. The archive's certainty had been assembled from what people had managed to carry away. An absence in the record was not the same as an absence in the universe. Still, she understood why the plant had frightened him. If the shoot belonged to that lost landscape, then a private box had carried a possibility the official inventory had declared finished.

The station administrator arrived before lunch. Her name was Sol, and she had once given Anya three extra litres of water for a trial everyone else considered unpromising. She listened to the story, examined the box, and asked what the plant would need. Anya had prepared a defence and found herself without a use for it. 'Time,' she said. 'And a separate air loop until we know more.' Sol looked at Deren. He was already drawing a valve.

The source field still refused the word unknown. Sol read the form, then opened the maintenance register and created a manual entry. Beneath the photograph, Anya wrote Lio's grandmother's name as carefully as she could from the label on the case. Deren added the chamber number. Lio wrote the date the packet had opened. The record was incomplete, but it existed. By evening, the plant had a place in the station that did not depend on pretending they understood it.`.split(/\n\n+/)},
  {title: 'A garden in the margin.', paragraphs: `The separate chamber began life as a cabinet for spare filters. Deren cleaned it, sealed the joints, and fitted a clear panel where the door had been. Anya installed a light and a small tray for water. Lio watched while she moved the pot inside. There was nothing ceremonial about the transfer. The shoot leaned slightly towards the lamp, as if the station's uncertainty were simply another direction from which light might arrive.

For three weeks, the plant grew slowly enough that Anya questioned every measurement. She photographed it at the same hour, using the edge of a ruler as a reference. The leaves darkened. A third appeared, then a fourth. None of this proved that they had recovered a lost species. She wrote possible in every report and resisted the temptation to remove it when other people began repeating the story with greater confidence.

The station newsletter called it the last rainflower. Anya asked for a correction. 'It may not be a rainflower,' she told the editor, 'and we don't know that it's the last.' The editor looked disappointed, then interested. The revised article described six packets, a metal case, and a grandmother who had carried seeds between worlds. More people read the second version. Several began checking boxes they had not opened since arriving on the station.

They brought Anya an extraordinary collection of ordinary things. Dried beans wrapped in cloth. A packet of flower seeds with no date. A leaf pressed into a book whose pages were coming loose. Most were unlikely to grow. She did not promise otherwise. Instead, she made a shelf for the collection and a record simple enough to accept an uncertain answer. Each object received a photograph, an account of its journey, and the name of the person who had kept it.

Lio came every evening after his shift. At first he stood outside the chamber with his hands behind his back, as though afraid of claiming too much responsibility. Eventually Anya gave him the water ledger. He was precise, sometimes unnecessarily so, but the ledger gave his visits a purpose beyond waiting for the plant to become proof of something. They talked about his grandmother. She had disliked ships, kept three clocks, and never learned to stop making food for more people than were present.

Anya remembered a garden from before the evacuation. Not her family's garden, but a strip of planted ground beside a public stairway. After rain, the steps smelled of warm stone. She had carried that memory for so long that she sometimes doubted whether it belonged to a real place. The soil in Lio's pot had returned the smell to her without returning the city around it. She was learning to be grateful for the piece without demanding the whole.

At the end of the first month, the station's water review arrived. The new chamber required almost nothing compared with the main glasshouse, but almost nothing still had to be accounted for. Sol called a meeting. Anya brought her measurements. Deren brought a proposal for recovering moisture from the cabinet's air loop. Lio brought the original packet. He placed it on the table, then moved it aside to make room for the figures.

They agreed on a trial period and a limit they could all understand. No one was asked to choose between a plant and the station's essential systems. The question was whether the station could make a small, reliable space for work whose value was not yet measurable. Anya had expected the discussion to be difficult. It was, but in the useful way a difficult calculation can be useful when everyone is willing to examine the same numbers.

Two months after the pot appeared, a pale bud formed between the upper leaves. Anya found it during the borrowed sunrise. She called Lio, then regretted waking him until he arrived still fastening his boots. They stood on either side of the chamber and said almost nothing. The bud was no larger than the end of a pencil. It did not know that several versions of a vanished world had gathered around it to wait.

The flower opened at an inconvenient hour, halfway through a scheduled power reduction. Under the low maintenance lights, its petals looked silver rather than white. Anya recorded what she could without adjusting the cycle. Deren brought a portable lamp. Sol appeared with cups of something warm. For a few minutes, the service corridor held more people than the small flower could possibly justify by any practical measure. Nobody asked it to justify them.

They sent the images to the archive with a careful description. Identification would take time, and there might never be enough surviving material for complete certainty. Anya found that she could tolerate this now. The plant was living in front of them. It needed appropriate care, a clear record, and the possibility of another generation. A name mattered. So did leaving enough room in the story for what they had not yet learned.

On the last page of the trial ledger, Lio wrote a proposal for a second cabinet. Anya read it while the station's artificial dawn warmed the glass. Outside, the moon continued its slow turn through the dark. Inside, a flower had begun to close, holding something at its centre they would examine in the morning. She added one line to Lio's proposal: Leave space for the next pot. Then she saved the record, switched off the desk light, and went to breakfast.`.split(/\n\n+/)}
];

export const books = originalBooks.map(book => ({...book, chapters:[...book.chapters, ...(continuations[book.id] || [])]}));
export const byId = Object.fromEntries(books.map(book => [book.id, book]));

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"}[character]));
}

export function renderCover(book) {
  // Cover line breaks are trusted, authored markup from this fixed catalog.
  return `<div class="book-cover ${escapeHtml(book.kind)}" aria-hidden="true"><span class="cover-kicker">${escapeHtml(book.kicker)}</span><span class="cover-title">${book.cover}</span><div class="art">${book.kind === "atlas" ? "<i></i><i></i><i></i><i></i><i></i><i></i>" : ""}</div><span class="cover-author">${escapeHtml(book.author)}</span></div>`;
}
