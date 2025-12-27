const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SCORES_FILE = path.join(__dirname, 'scores.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize scores file if it doesn't exist
async function initScoresFile() {
    try {
        await fs.access(SCORES_FILE);
    } catch {
        await fs.writeFile(SCORES_FILE, JSON.stringify([], null, 2));
    }
}

// Load scores from file
async function loadScores() {
    try {
        const data = await fs.readFile(SCORES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading scores:', error);
        return [];
    }
}

// Save scores to file
async function saveScores(scores) {
    try {
        await fs.writeFile(SCORES_FILE, JSON.stringify(scores, null, 2));
    } catch (error) {
        console.error('Error saving scores:', error);
    }
}

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Bakabakaband Score Server</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
                    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
                    .info { background: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; }
                    .endpoint { margin: 10px 0; padding: 10px; background: #f5f5f5; border-left: 4px solid #2196F3; }
                    code { background: #e0e0e0; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
                    a { color: #2196F3; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎮 Bakabakaband Score Server</h1>
                    <div class="info">
                        <p><strong>Welcome to the Bakabakaband Score Server!</strong></p>
                        <p>This server accepts JSON game dumps from Bakabakaband and maintains a score leaderboard.</p>
                    </div>

                    <h2>Available Endpoints:</h2>

                    <div class="endpoint">
                        <h3>📊 <a href="/scores">GET /scores</a></h3>
                        <p>View all scores in JSON format</p>
                    </div>

                    <div class="endpoint">
                        <h3>🏆 <a href="/leaderboard">GET /leaderboard</a></h3>
                        <p>View formatted leaderboard (HTML)</p>
                    </div>

                    <div class="endpoint">
                        <h3>📤 POST /submit</h3>
                        <p>Submit a new score (JSON dump from Bakabakaband)</p>
                        <p><small>Example: <code>curl -X POST http://localhost:${PORT}/submit -H "Content-Type: application/json" -d @dump.json</code></small></p>
                    </div>

                    <div class="endpoint">
                        <h3>🗑️ DELETE /scores/:id</h3>
                        <p>Delete a specific score by ID</p>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Submit a new score
app.post('/submit', async (req, res) => {
    try {
        const dump = req.body;

        // Validate that we have some basic data
        if (!dump || typeof dump !== 'object') {
            return res.status(400).json({ error: 'Invalid JSON dump' });
        }

        // Extract fields from nested structure (Bakabakaband format)
        // or flat structure (legacy/test format)
        const basic = dump.basic || {};
        const status = dump.status || {};
        const death = dump.death || {};

        // Create score entry
        const scoreEntry = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            dump: dump,
            // Extract key fields - try nested structure first, then flat structure
            characterName: basic.name || dump.character_name || dump.name || 'Unknown',
            level: basic.level || dump.level || dump.max_plv || 0,
            experience: basic.experience || dump.exp || 0,
            race: basic.race || dump.race || dump.prace || 'Unknown',
            class: basic.class || dump.class || dump.pclass || 'Unknown',
            deathCause: death.cause || dump.died_from || dump.last_message || 'Unknown',
            score: basic.experience || dump.score || dump.exp || 0,
            // Additional useful fields
            maxHp: status.max_hitpoints || dump.maxhp || 0,
            gold: status.gold || dump.au || 0,
            dungeonLevel: status.dungeon_level || dump.depth || 0,
            isWinner: death.is_winner || false
        };

        // Load existing scores
        const scores = await loadScores();

        // Add new score
        scores.push(scoreEntry);

        // Sort by score (descending)
        scores.sort((a, b) => (b.score || 0) - (a.score || 0));

        // Save scores
        await saveScores(scores);

        res.json({
            success: true,
            message: 'Score submitted successfully',
            id: scoreEntry.id,
            rank: scores.findIndex(s => s.id === scoreEntry.id) + 1
        });
    } catch (error) {
        console.error('Error submitting score:', error);
        res.status(500).json({ error: 'Failed to submit score', details: error.message });
    }
});

// Get all scores
app.get('/scores', async (req, res) => {
    try {
        const scores = await loadScores();
        res.json(scores);
    } catch (error) {
        console.error('Error fetching scores:', error);
        res.status(500).json({ error: 'Failed to fetch scores' });
    }
});

// Get leaderboard (formatted HTML)
app.get('/leaderboard', async (req, res) => {
    try {
        const scores = await loadScores();

        const html = `
            <html>
                <head>
                    <title>Bakabakaband Leaderboard</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 20px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                        }
                        .container {
                            max-width: 1200px;
                            margin: 0 auto;
                            background: white;
                            padding: 30px;
                            border-radius: 12px;
                            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                        }
                        h1 {
                            color: #333;
                            text-align: center;
                            margin-bottom: 10px;
                            font-size: 2.5em;
                        }
                        .subtitle {
                            text-align: center;
                            color: #666;
                            margin-bottom: 30px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-top: 20px;
                        }
                        th {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 15px;
                            text-align: left;
                            font-weight: bold;
                            position: sticky;
                            top: 0;
                        }
                        td {
                            padding: 12px 15px;
                            border-bottom: 1px solid #ddd;
                        }
                        tr:hover {
                            background: #f5f5f5;
                        }
                        .rank {
                            font-weight: bold;
                            font-size: 1.2em;
                            text-align: center;
                            width: 60px;
                        }
                        .rank-1 { color: #FFD700; text-shadow: 0 0 10px rgba(255,215,0,0.5); }
                        .rank-2 { color: #C0C0C0; text-shadow: 0 0 10px rgba(192,192,192,0.5); }
                        .rank-3 { color: #CD7F32; text-shadow: 0 0 10px rgba(205,127,50,0.5); }
                        .score {
                            font-weight: bold;
                            color: #4CAF50;
                            text-align: right;
                        }
                        .level {
                            text-align: center;
                            color: #2196F3;
                            font-weight: bold;
                        }
                        .winner {
                            background: #FFD700;
                            color: #fff;
                            padding: 2px 8px;
                            border-radius: 4px;
                            font-weight: bold;
                            font-size: 0.85em;
                            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
                        }
                        .depth {
                            text-align: center;
                            color: #9C27B0;
                            font-weight: bold;
                        }
                        .timestamp {
                            color: #999;
                            font-size: 0.9em;
                        }
                        .no-scores {
                            text-align: center;
                            padding: 40px;
                            color: #999;
                            font-size: 1.2em;
                        }
                        .refresh-btn {
                            display: block;
                            margin: 20px auto 0;
                            padding: 10px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            border: none;
                            border-radius: 25px;
                            cursor: pointer;
                            font-size: 1em;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                            transition: transform 0.2s;
                        }
                        .refresh-btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(0,0,0,0.3);
                        }
                    </style>
                    <meta http-equiv="refresh" content="30">
                </head>
                <body>
                    <div class="container">
                        <h1>🏆 Bakabakaband Leaderboard</h1>
                        <div class="subtitle">Total Scores: ${scores.length} | Auto-refreshes every 30 seconds</div>

                        ${scores.length === 0 ?
                            '<div class="no-scores">No scores yet. Be the first to submit!</div>' :
                            `<table>
                                <thead>
                                    <tr>
                                        <th>Rank</th>
                                        <th>Character</th>
                                        <th>Race</th>
                                        <th>Class</th>
                                        <th>Level</th>
                                        <th>Depth</th>
                                        <th>Score</th>
                                        <th>Death</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${scores.map((score, index) => {
                                        const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
                                        const date = new Date(score.timestamp);
                                        const winnerBadge = score.isWinner ? '<span class="winner">WINNER</span>' : '';
                                        return `
                                            <tr>
                                                <td class="rank ${rankClass}">${index + 1}</td>
                                                <td><strong>${escapeHtml(score.characterName)}</strong> ${winnerBadge}</td>
                                                <td>${escapeHtml(score.race)}</td>
                                                <td>${escapeHtml(score.class)}</td>
                                                <td class="level">Lv.${score.level}</td>
                                                <td class="depth">${score.dungeonLevel > 0 ? 'D:' + score.dungeonLevel : '-'}</td>
                                                <td class="score">${score.score.toLocaleString()}</td>
                                                <td>${escapeHtml(score.deathCause)}</td>
                                                <td class="timestamp">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>`
                        }

                        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Now</button>
                    </div>
                </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).send('Error loading leaderboard');
    }
});

// Helper function to escape HTML
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Delete a score by ID
app.delete('/scores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let scores = await loadScores();

        const initialLength = scores.length;
        scores = scores.filter(s => s.id !== id);

        if (scores.length === initialLength) {
            return res.status(404).json({ error: 'Score not found' });
        }

        await saveScores(scores);
        res.json({ success: true, message: 'Score deleted successfully' });
    } catch (error) {
        console.error('Error deleting score:', error);
        res.status(500).json({ error: 'Failed to delete score' });
    }
});

// Start server
async function startServer() {
    await initScoresFile();
    app.listen(PORT, () => {
        console.log(`🎮 Bakabakaband Score Server running on http://localhost:${PORT}`);
        console.log(`📊 View leaderboard at http://localhost:${PORT}/leaderboard`);
        console.log(`📤 Submit scores to http://localhost:${PORT}/submit`);
    });
}

startServer().catch(console.error);
