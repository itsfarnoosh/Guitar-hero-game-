import "./style.css"; // Importing the stylesheet for the game.

import { Observable, of, fromEvent, interval, timer, from, merge } from "rxjs"; // Importing RxJS functions for reactive programming.
import { map, filter, scan, takeUntil, switchMap, take, tap,debounceTime } from "rxjs/operators"; // Importing RxJS operators to manipulate streams.
import * as Tone from "tone"; // Importing Tone.js for sound synthesis.
import { SampleLibrary } from "./tonejs-instruments"; // Importing a library of musical instruments for the game.

/** Constants */

// Constants to define the viewport dimensions of the game.
const Viewport = {
    CANVAS_WIDTH: 200,
    CANVAS_HEIGHT: 400,
} as const;

// Other game constants such as tick rate and song name.
const Constants = {
    TICK_RATE_MS: 500,
    SONG_NAME: "RockinRobin",
    HIT_STREAK_FOR_MULTIPLIER: 10, // Number of consecutive hits needed to increase the score multiplier
} as const;

// Constants related to the visual representation of notes.
const NoteConfig = {
    RADIUS: 0.07 * Viewport.CANVAS_WIDTH,
    TAIL_WIDTH: 10,
    TAIL_MIN_DURATION: 1000, // Minimum duration for a tail to appear
};

/** User input */

// Types to define the keys that can be pressed by the user.
type Key = "KeyH" | "KeyJ" | "KeyK" | "KeyL";

// Types to define different keyboard events.
type Event = "keydown" | "keyup" | "keypress";

/** State processing */

// The state object defines the state of the game, like whether the game has ended.
type State = Readonly<{
    gameEnd: boolean;
    score: number;
    multiplier: number;
    hitStreak: number; // New field to track consecutive hits
    highScore: number;
}>;

// Initial game state: the game hasn't ended when it starts.
const initialState: State = {
    gameEnd: false,
    score: 0,
    multiplier: 1,
    hitStreak: 0,
    highScore: 0,
} as const;

/**
 * Utility function to set multiple attributes on an SVG element.
 * 
 * @param element - The SVG element to which the attributes will be applied.
 * @param attributes - An object containing the attributes and their corresponding values.
 */
function attr(element: SVGElement, attributes: Record<string, string | number>): void {
    // Iterate over each entry in the attributes object.
    Object.entries(attributes).forEach(([key, value]) => {
        // Convert each attribute's value to a string and set it on the SVG element.
        element.setAttribute(key, value.toString());
    });
}

/**
 * Updates the view by modifying the DOM elements according to the game state.
 *
 * @param s Current state
 * @returns Updated state (not strictly necessary here, but included for consistency)
 */
const updateView = (s: State): void => {
    const scoreText = document.getElementById("scoreText");
    const multiplierText = document.getElementById("multiplierText");
    const highScoreText = document.getElementById("highScoreText");

    if (scoreText) {
        scoreText.textContent = `${s.score}`;
    }
    if (multiplierText) {
        multiplierText.textContent = `${s.multiplier.toFixed(1)}x`;
    }
    if (highScoreText) {
        highScoreText.textContent = `${s.highScore}`; // Update high score text
    }

    // Check if the game has ended.
    if (s.gameEnd) {
        // Attempt to get the SVG canvas element by its ID.
        const svg = document.getElementById("svgCanvas") as SVGElement | null;

        // Ensure the SVG canvas element exists before proceeding.
        if (svg) {
            // Create a new SVG 'text' element within the same namespace as the SVG.
            const gameOverText = document.createElementNS(svg.namespaceURI, "text") as SVGElement;

            // Set attributes for the 'text' element to position it on the canvas and apply a class for styling.
            // The 'x' and 'y' attributes define the position of the text on the SVG canvas.
            // 'class' attribute is used to apply styles (like colour, font size, etc.) defined in a stylesheet.
            attr(gameOverText, { 
                x: Viewport.CANVAS_WIDTH / 4,  // Horizontal position, calculated as a quarter of the canvas width.
                y: Viewport.CANVAS_HEIGHT / 2, // Vertical position, centered at half the canvas height.
                class: "gameover"              // Class name for styling purposes.
            });

            // Set the content of the 'text' element to display "Game Over".
            gameOverText.textContent = "Game Over";

            // Append the 'text' element to the SVG canvas to make it visible on the screen.
            svg.appendChild(gameOverText);
        }
    }

};

/**
 * Loads the high score from local storage.
 *
 * @returns The high score as a number.
 */
const loadHighScore = (): number => {
    const storedHighScore = localStorage.getItem("highScore");
    return storedHighScore ? parseInt(storedHighScore, 10) : 0;
};

/**
 * Saves the high score to local storage.
 *
 * @param score - The score to save as the high score.
 */
const saveHighScore = (score: number): void => {
    localStorage.setItem("highScore", score.toString());
};

/**
 * Initializes the reset button, allowing the user to reset the high score.
 */
const initializeResetButton = () => {
    const resetButton = document.getElementById("resetHighScoreButton");
    if (resetButton) {
        resetButton.addEventListener("click", () => {
            localStorage.setItem("highScore", "0"); // Reset high score in localStorage to zero
            const newState = { ...initialState, highScore: 0 };
            updateView(newState); // Reset the view
        });
    }
};

/**
 * Displays an SVG element on the canvas. Brings it to the foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGGraphicsElement) => {
    elem.setAttribute("visibility", "visible"); // Makes an SVG element visible.
    elem.parentNode!.appendChild(elem); // Brings the SVG element to the foreground.
};

/**
 * Hides an SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGGraphicsElement) =>
    elem.setAttribute("visibility", "hidden"); // Hides an SVG element by changing its visibility attribute.

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
) => {
    const elem = document.createElementNS(namespace, name) as SVGElement; // Creates a new SVG element.
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v)); // Sets the properties of the SVG element.
    return elem; // Returns the created SVG element.
};

/** Note data structure */

/**
 * Type representing a note in the game.
 */
type GameNote = {
    userPlayed: boolean;
    instrumentName: string;
    velocity: number;
    pitch: number;
    start: number;
    end: number;
    column: number;
    tailDuration?: number; // Optional field for the tail duration
};

/**
 * Parse the CSV content into an array of note objects.
 *
 * @param csvContent The raw CSV content as a string.
 * @returns An array of Note objects.
 */
function parseNotes(csvContent: string): GameNote[] {
    // Trim any extra whitespace from the CSV content and split it into lines based on the newline character.
    const lines = csvContent.trim().split("\n");

    // Slice off the first line (which is the header) and map over the remaining lines to create an array of Note objects.
    return lines.slice(1).map(line => {
        // Split each line into an array of strings by separating it at each comma.
        const [userPlayed, instrumentName, velocity, pitch, start, end] = line.split(",");

        // Assign a column based on pitch or another rule
        const column = parseInt(pitch.trim(), 10) % 4;

        // Calculate the tail duration
        const tailDuration = (parseFloat(end.trim()) - parseFloat(start.trim())) * 1000;

        // Return a Note object with the following properties:
        return {
            userPlayed: userPlayed.trim().toLowerCase() === "true",
            instrumentName: instrumentName.trim(),
            velocity: parseFloat(velocity.trim()) / 127,
            pitch: parseInt(pitch.trim(), 10),
            start: parseFloat(start.trim()),
            end: parseFloat(end.trim()),
            column,
            tailDuration: tailDuration > NoteConfig.TAIL_MIN_DURATION ? tailDuration : undefined,
        };
    });
}

/**
 * Creates an Observable for the specified key press event.
 *
 * @param keyCode The key code for which the observable is created.
 * @returns Observable of key press events.
 */
const fromKey = (keyCode: Key) =>
    fromEvent<KeyboardEvent>(document, "keypress").pipe(filter(({ code }) => code === keyCode)); // Filters the keypress events to match specific keys.

/**
 * Creates an Observable for the specified key up event.
 *
 * @param keyCode The key code for which the observable is created.
 * @returns Observable of key up events.
 */
const fromKeyUp = (keyCode: Key) =>
    fromEvent<KeyboardEvent>(document, "keyup").pipe(filter(({ code }) => code === keyCode)); // Filters the key up events to match specific keys.

/**
 * Columns definition for the game. Maps keys to colors and positions.
 */
const columns = [
    { key: "KeyH" as Key, color: "green", columnPosition: "20%" },
    { key: "KeyJ" as Key, color: "red", columnPosition: "40%" },
    { key: "KeyK" as Key, color: "blue", columnPosition: "60%" },
    { key: "KeyL" as Key, color: "yellow", columnPosition: "80%" },
];

/**
 * Animates the circles (notes) falling down the screen.
 *
 * @param state The current game state.
 * @param notes The array of GameNotes to be animated.
 * @param svg The SVG canvas element where the animation occurs.
 * @param samples The loaded samples (instruments) used to play notes.
 * @returns The updated game state.
 */
const animateCircles = (
    state: State, 
    notes: GameNote[], 
    svg: SVGGraphicsElement, 
    samples: { [key: string]: Tone.Sampler }
): State => {
    // Helper function to determine the column number for a note based on its pitch.
    const getColumnForNote = (pitch: number): number => pitch % 4;

    // Function to animate a single note.
    const animateNote = (note: GameNote) => {
        // Determine the column where the note should appear.
        const column = columns[getColumnForNote(note.pitch)];

        // Initial and final vertical positions of the circle (note).
        const circleStartY = -NoteConfig.RADIUS;
        const circleEndY = Viewport.CANVAS_HEIGHT + NoteConfig.RADIUS;
        // Calculate the end position of the note's tail, if it has one.
        const tailEndY = circleEndY + (note.tailDuration ? note.tailDuration / 10 : 0);

        // Define the total time for the note to travel down the screen (in milliseconds).
        const travelTime = 3000; // 3 seconds
        // Calculate the speed of the circle's movement.
        const circleSpeed = (circleEndY - circleStartY) / travelTime;

        // Calculate the start time of the note animation, taking into account a delay.
        const startTime = note.start * 1000 - 3000; // Convert note start time to milliseconds and apply delay
        // Set the radius of the note circle, slightly increased for visual effect.
        const increasedRadius = NoteConfig.RADIUS * 0.8;

        // Timer to start the animation after the calculated delay.
        timer(startTime).subscribe(() => {
            // Create an SVG 'circle' element representing the falling note.
            const circle = createSvgElement(svg.namespaceURI, "circle", {
                r: `${increasedRadius}`, // Radius of the circle
                cx: column.columnPosition, // X position based on the column
                cy: `${circleStartY}`, // Y position starting from above the screen
                fill: `url(#${column.color}Gradient)`, // Gradient fill color
                stroke: "transparent",
                "stroke-width": "2",
            });

            // Append the circle to the SVG canvas.
            svg.appendChild(circle);

            // Optionally create a 'rect' element for the note's tail, if it has a duration.
            const tail = note.tailDuration
                ? createSvgElement(svg.namespaceURI, "rect", {
                    x: String(parseFloat(column.columnPosition) - NoteConfig.TAIL_WIDTH / 2), // X position for the tail
                    y: String(circleStartY), // Y position starting from above the screen
                    width: `${NoteConfig.TAIL_WIDTH}`, // Width of the tail
                    height: `0`, // Initial height of the tail
                    style: `fill: ${column.color}; opacity: 0.5;`, // Tail style
                })
                : null;

            // If the tail exists, insert it behind the circle on the SVG canvas.
            if (tail) {
                svg.insertBefore(tail, circle);
            }

            // Create an interval to update the position of the circle and its tail every 10ms.
            interval(10)
                .pipe(
                    // Calculate new positions for the circle and tail.
                    scan(
                        ({ y, height }) => ({
                            y: y + circleSpeed * 10, // Update y position
                            height: note.tailDuration
                                ? Math.min(height + circleSpeed * 10, note.tailDuration / 10) // Update tail height if applicable
                                : 0,
                        }),
                        {
                            y: circleStartY, // Initial y position
                            height: 0, // Initial tail height
                        }
                    ),
                    // Stop the interval when the note has traveled the entire screen.
                    takeUntil(timer(travelTime + (tailEndY - circleStartY) / circleSpeed))
                )
                .subscribe(({ y, height }) => {
                    // Update the circle's 'cy' attribute to move it down the screen.
                    circle.setAttribute("cy", String(y));

                    // Update the tail's position and height if it exists.
                    if (tail) {
                        tail.setAttribute("x", circle.getAttribute("cx") || "0");
                        tail.setAttribute("y", String(y - height));
                        tail.setAttribute("height", String(height));
                    }

                    // Remove the circle and tail from the SVG canvas when they go off-screen.
                    if (y >= circleEndY) {
                        svg.removeChild(circle);
                        if (tail && y >= tailEndY) {
                            svg.removeChild(tail);
                        }
                    }
                });

            // Handle user key press events to check for note hits and update the game state.
            handleKeyPress(circle, note, column.key, state, samples).subscribe(newState => {
                console.log("Observable emitted new state:", newState); // Log the new state
                state = newState; // Update the game state with the new state
                updateView(state); // Ensure the view is updated with the new state
            });
        });
    };

    // Filter the notes to animate only the ones that are marked as user-played.
    notes
        .filter(note => note.userPlayed)
        .forEach(animateNote); // Animate each user-played note

    return state; // Return the updated game state.
};

/**
 * Decrements the score based on the current state, resetting the multiplier and hit streak.
 *
 * @param state The current game state.
 * @returns Observable emitting the updated game state.
 */
const decrementScore = (state: State): Observable<State> => {
    return of(state).pipe(
        map(currentState => {
            const newScore = Math.max(currentState.score - 1, 0);
            return {
                ...currentState,
                score: newScore,
                hitStreak: 0, // Reset hit streak on a miss
                multiplier: 1, // Reset multiplier on a miss
            };
        }),
        tap(newState => updateView(newState)) // Update the view with the new state.
    );
};

/**
 * Increments the score based on the current state, adjusting the multiplier and hit streak.
 *
 * @param state The current game state.
 * @returns Observable emitting the updated game state.
 */
/**
 * Increments the score based on the current state, adjusting the multiplier and hit streak.
 *
 * @param state The current game state.
 * @returns Observable emitting the updated game state.
 */
const incrementScore = (state: State): Observable<State> => {
    return of(state).pipe(
        map(currentState => {
            const newScore = currentState.score + 1;
            const newHitStreak = currentState.hitStreak + 1;
            const newMultiplier = (newHitStreak >= Constants.HIT_STREAK_FOR_MULTIPLIER)
                ? currentState.multiplier + 0.2
                : currentState.multiplier;

            // Check if the current score is higher than the stored high score
            const newHighScore = Math.max(currentState.highScore, newScore);

            // Return the updated state
            return {
                ...currentState,
                score: newScore,
                hitStreak: (newHitStreak >= Constants.HIT_STREAK_FOR_MULTIPLIER) ? 0 : newHitStreak,
                multiplier: newMultiplier,
                highScore: newHighScore // Update high score if needed
            };
        }),
        tap(newState => {
            // Update the view with the new state
            updateView(newState);

            // Save the new high score if it has changed
            if (newState.highScore > loadHighScore()) {
                saveHighScore(newState.highScore);
            }
        })
    );
};


/**
 * Handles the key press event, evaluating if the note was played correctly.
 * switchMap to  manage keypress events based on timing and state
 * debounceTime prevents multiple triggers from closely spaced presses
 * @param circle The SVG circle element representing the note.
 * @param note The note associated with the key press.
 * @param key The key that was pressed.
 * @param state The current game state.
 * @param samples The loaded samples (instruments) used to play notes.
 * @returns Observable emitting the updated game state.
 */
const handleKeyPress = (
    circle: SVGElement,
    note: GameNote,
    key: Key,
    state: State,
    samples: { [key: string]: Tone.Sampler }
): Observable<State> => {
    return fromKey(key).pipe(
        debounceTime(150), // Debounce to prevent multiple close triggers
        switchMap(() => {
            const yPos = parseFloat(circle.getAttribute("cy") || "0");

            const hitWindowStart = Viewport.CANVAS_HEIGHT - NoteConfig.RADIUS - 80;
            const hitWindowEnd = Viewport.CANVAS_HEIGHT - NoteConfig.RADIUS + 120;

            const correctKey = key === columns[note.column].key;
            const correctTiming = yPos >= hitWindowStart && yPos <= hitWindowEnd;

            if (correctKey && correctTiming && note.userPlayed) {
                playNote(note, samples);
                circle.remove(); // Remove the circle after a successful hit
                return incrementScore(state); // Increment the score on a successful hit
            } else if (correctKey && !correctTiming && note.userPlayed) {
                const randomNote = getRandomNote(samples); // Get a random note
                playNote(randomNote, samples); // Play the random note
                return decrementScore(state); // Decrement the score on a miss
            }

            return of(state); // No change if incorrect key or timing
        })
    );
};

/**
 * Plays a note using Tone.js.
 *
 * @param note The note to be played.
 * @param samples The loaded samples (instruments) used to play notes.
 */
const playNote = (note: GameNote, samples: { [key: string]: Tone.Sampler }) => {
    // Create an observable from the note
    of(note)
        .pipe(
            // Filter out invalid notes (e.g., where the instrument is not found)
            filter(note => samples.hasOwnProperty(note.instrumentName)),

            // Map the note to the sound parameters and trigger the note
            map(note => ({
                frequency: Tone.Frequency(note.pitch, "midi").toNote(),
                duration: note.end - note.start,
                velocity: note.velocity,
                instrument: samples[note.instrumentName]
            }))
        )
        .subscribe(({ frequency, duration, velocity, instrument }) => {
            // Trigger the sound using the mapped parameters
            instrument.triggerAttackRelease(frequency, duration, undefined, velocity);
        });
};

/**
 * Generates a random note that can be played.
 *
 * @param samples The loaded samples (instruments) used to play notes.
 * @returns A randomly generated GameNote.
 */
const getRandomNote = (samples: { [key: string]: Tone.Sampler }): GameNote => {
    const instrumentNames = Object.keys(samples);
    const randomInstrumentName = instrumentNames[Math.floor(Math.random() * instrumentNames.length)];
    const randomPitch = Math.floor(Math.random() * 88) + 21; // MIDI range from 21 (A0) to 108 (C8)
    const randomVelocity = Math.random() * 0.3; // Velocity between 0 and 0.3
    const start = Tone.now();
    const duration = Math.random() * 0.5; // Duration between 0 and 0.5 seconds
    return {
        userPlayed: false,
        instrumentName: randomInstrumentName,
        velocity: randomVelocity,
        pitch: randomPitch,
        start,
        end: start + duration,
        column: randomPitch % 4,
    };
};

/**
 * Plays background notes (non-user-played notes) at their respective start times.
 *
 * @param notes The array of GameNotes to be played in the background.
 * @param samples The loaded samples (instruments) used to play notes.
 */
const playBackgroundNotes = (notes: GameNote[], samples: { [key: string]: Tone.Sampler }) => {
    notes
        .filter(note => !note.userPlayed) // Filter for background notes
        .forEach(note => {
            timer(note.start * 1000).subscribe(() => playNote(note, samples)); // Play each note after its start time
        });
};

/**
 * This is the function called on page load. Your main game loop
 * should be called here.
 *
 * @param csvContents The CSV contents representing the game's notes.
 * @param samples The loaded samples (instruments) used in the game.
 */
export function main(
    csvContents: string,
    samples: { [key: string]: Tone.Sampler },
) {
    // Canvas elements
    const svg = document.querySelector("#svgCanvas") as SVGGraphicsElement &
        HTMLElement;
    const preview = document.querySelector(
        "#svgPreview",
    ) as SVGGraphicsElement & HTMLElement;
    const gameover = document.querySelector("#gameOver") as SVGGraphicsElement &
        HTMLElement;
    const container = document.querySelector("#main") as HTMLElement;
    const notes = parseNotes(csvContents);

    svg.setAttribute("height", `${Viewport.CANVAS_HEIGHT}`);
    svg.setAttribute("width", `${Viewport.CANVAS_WIDTH}`);

    const totalDuration = Math.max(...notes.map(note => note.end)) * 1000;

    const highScore = loadHighScore(); // Load the high score
    const initialStateWithHighScore = { ...initialState, highScore }; // Initialize state with loaded high score

    animateCircles(initialStateWithHighScore, notes, svg, samples);
    playBackgroundNotes(notes, samples);

    const tick$ = interval(Constants.TICK_RATE_MS);

    tick$
        .pipe(scan((s: State) => ({ gameEnd: false, score: s.score, multiplier: s.multiplier, hitStreak: s.hitStreak, highScore: s.highScore }), initialStateWithHighScore))
        .subscribe((s: State) => {
            if (s.gameEnd) {
                show(gameover);
            } else {
                hide(gameover);
            }
        });

    timer(totalDuration).subscribe(() => {
        tick$.subscribe(() => ({ gameEnd: true }));
        show(gameover);
    });

    initializeResetButton(); // Initialize the reset button
}


// The following simply runs your main function on window load. Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    // Load in the instruments and then start your game!
    const samples = SampleLibrary.load({
        instruments: [
            "bass-electric",
            "violin",
            "piano",
            "trumpet",
            "saxophone",
            "trombone",
            "flute",
        ], // Load the instruments that will be used in the game.
        baseUrl: "samples/",
    });

    const startGame = (contents: string) => {
        document.body.addEventListener(
            "mousedown",
            function () {
                main(contents, samples);
            },
            { once: true },
        );
    };

    const { protocol, hostname, port } = new URL(import.meta.url); // Parses the current URL to construct the base URL for fetching assets.
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;

    Tone.ToneAudioBuffer.loaded().then(() => {
        for (const instrument in samples) {
            samples[instrument].toDestination();
            samples[instrument].release = 0.5;
        }

        fetch(`${baseUrl}/assets/${Constants.SONG_NAME}.csv`)
            .then((response) => response.text())
            .then((text) => startGame(text))
            .catch((error) =>
                console.error("Error fetching the CSV file:", error),
            );
    });
}
