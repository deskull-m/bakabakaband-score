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
                    body { font-family: Arial, sans-serif; margin: 20px; background: #0a0a0a; color: #e0e0e0; }
                    .container { max-width: 1200px; margin: 0 auto; background: #1a1a1a; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); border: 1px solid #333; }
                    h1 { color: #ffcc00; border-bottom: 2px solid #ff3333; padding-bottom: 10px; text-shadow: 0 0 10px rgba(255, 204, 0, 0.5); }
                    .info { background: #2a2a2a; padding: 15px; border-radius: 4px; margin: 20px 0; border: 1px solid #ffcc00; }
                    .endpoint { margin: 10px 0; padding: 10px; background: #252525; border-left: 4px solid #ff3333; }
                    .endpoint h3 { color: #ffcc00; }
                    code { background: #333; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; color: #ffcc00; }
                    a { color: #ffcc00; text-decoration: none; }
                    a:hover { color: #ff3333; text-decoration: underline; }
                    p { color: #ccc; }
                    strong { color: #ffcc00; }
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
            characterName:
        basic.name || dump.character_name || dump.name || 'Unknown',
            level: basic.level || dump.level || dump.max_plv || 0,
            experience: basic.experience || dump.exp || 0,
            race: basic.race || dump.race || dump.prace || 'Unknown',
            class: basic.class || dump.class || dump.pclass || 'Unknown',
            deathCause:
        death.cause || dump.died_from || dump.last_message || 'Unknown',
            score: basic.experience || dump.score || dump.exp || 0,
            // Additional useful fields
            maxHp: status.max_hitpoints || dump.maxhp || 0,
            gold: status.gold || dump.au || 0,
            dungeonLevel: status.dungeon_level || dump.depth || 0,
            isWinner: death.is_winner || false,
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
            rank: scores.findIndex((s) => s.id === scoreEntry.id) + 1,
        });
    } catch (error) {
        console.error('Error submitting score:', error);
        res
            .status(500)
            .json({ error: 'Failed to submit score', details: error.message });
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
                            background: #0a0a0a;
                            min-height: 100vh;
                        }
                        .container {
                            max-width: 1200px;
                            margin: 0 auto;
                            background: #1a1a1a;
                            padding: 30px;
                            border-radius: 12px;
                            box-shadow: 0 10px 30px rgba(255, 51, 51, 0.3);
                            border: 2px solid #333;
                        }
                        h1 {
                            color: #ffcc00;
                            text-align: center;
                            margin-bottom: 10px;
                            font-size: 2.5em;
                            text-shadow: 0 0 20px rgba(255, 204, 0, 0.6);
                        }
                        .subtitle {
                            text-align: center;
                            color: #999;
                            margin-bottom: 30px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-top: 20px;
                        }
                        th {
                            background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
                            color: #ffcc00;
                            padding: 15px;
                            text-align: left;
                            font-weight: bold;
                            position: sticky;
                            top: 0;
                            border-bottom: 2px solid #ff3333;
                        }
                        td {
                            padding: 12px 15px;
                            border-bottom: 1px solid #333;
                            color: #e0e0e0;
                        }
                        tr:hover {
                            background: #252525;
                            cursor: pointer;
                        }
                        .rank {
                            font-weight: bold;
                            font-size: 1.2em;
                            text-align: center;
                            width: 60px;
                        }
                        /* Modal styles */
                        .modal {
                            display: none;
                            position: fixed;
                            z-index: 1000;
                            left: 0;
                            top: 0;
                            width: 100%;
                            height: 100%;
                            background-color: rgba(0,0,0,0.7);
                            animation: fadeIn 0.3s;
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        .modal-content {
                            background-color: #1a1a1a;
                            margin: 5% auto;
                            padding: 0;
                            border: 2px solid #ffcc00;
                            width: 90%;
                            max-width: 900px;
                            max-height: 85vh;
                            border-radius: 8px;
                            box-shadow: 0 4px 20px rgba(255, 204, 0, 0.3);
                            display: flex;
                            flex-direction: column;
                        }
                        .modal-header {
                            background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
                            color: #ffcc00;
                            padding: 20px;
                            border-radius: 8px 8px 0 0;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            border-bottom: 2px solid #ff3333;
                        }
                        .modal-header h2 {
                            margin: 0;
                            font-size: 1.5em;
                        }
                        .close {
                            color: #ffcc00;
                            font-size: 32px;
                            font-weight: bold;
                            cursor: pointer;
                            line-height: 1;
                            transition: transform 0.2s, color 0.2s;
                        }
                        .close:hover,
                        .close:focus {
                            transform: rotate(90deg);
                            color: #ff3333;
                        }
                        .modal-body {
                            padding: 20px;
                            overflow-y: auto;
                            flex: 1;
                            background: #1a1a1a;
                        }
                        .json-container {
                            background: #0a0a0a;
                            color: #e0e0e0;
                            padding: 20px;
                            border-radius: 4px;
                            overflow-x: auto;
                            font-family: 'Courier New', monospace;
                            font-size: 13px;
                            line-height: 1.5;
                            border: 1px solid #333;
                        }
                        .json-key {
                            color: #ffcc00;
                        }
                        .json-string {
                            color: #ff9933;
                        }
                        .json-number {
                            color: #ff6666;
                        }
                        .json-boolean {
                            color: #ffcc00;
                        }
                        .json-null {
                            color: #999;
                        }
                        .copy-btn {
                            background: #ffcc00;
                            color: #0a0a0a;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                            font-weight: bold;
                            margin-top: 10px;
                            transition: background 0.3s, transform 0.2s;
                        }
                        .copy-btn:hover {
                            background: #ff3333;
                            color: white;
                            transform: translateY(-2px);
                        }
                        .copy-btn:active {
                            background: #cc0000;
                            transform: translateY(0);
                        }
                        .status-container {
                            margin-bottom: 20px;
                        }
                        .status-section {
                            background: #252525;
                            border-radius: 6px;
                            padding: 15px;
                            margin-bottom: 15px;
                            border: 1px solid #333;
                        }
                        .status-section h3 {
                            margin: 0 0 15px 0;
                            color: #ffcc00;
                            border-bottom: 2px solid #ff3333;
                            padding-bottom: 8px;
                            font-size: 1.1em;
                        }
                        .status-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                            gap: 12px;
                        }
                        .status-item {
                            display: flex;
                            justify-content: space-between;
                            padding: 8px 12px;
                            background: #1a1a1a;
                            border-radius: 4px;
                            border-left: 3px solid #ffcc00;
                        }
                        .status-label {
                            font-weight: 600;
                            color: #999;
                        }
                        .status-value {
                            color: #ffcc00;
                            font-weight: 500;
                        }
                        .stats-table {
                            width: 100%;
                            background: #1a1a1a;
                            border-radius: 4px;
                            overflow: hidden;
                            border: 1px solid #333;
                        }
                        .stats-table th {
                            background: #2a2a2a;
                            color: #ffcc00;
                            padding: 10px;
                            text-align: center;
                            font-size: 0.9em;
                            border-bottom: 2px solid #ff3333;
                        }
                        .stats-table td {
                            padding: 10px;
                            text-align: center;
                            border-bottom: 1px solid #333;
                            color: #e0e0e0;
                        }
                        .stats-table tr:last-child td {
                            border-bottom: none;
                        }
                        .tab-container {
                            margin-bottom: 15px;
                        }
                        .tab-buttons {
                            display: flex;
                            gap: 5px;
                            margin-bottom: 15px;
                        }
                        .tab-btn {
                            flex: 1;
                            padding: 10px 20px;
                            background: #2a2a2a;
                            border: none;
                            cursor: pointer;
                            font-size: 14px;
                            font-weight: 600;
                            transition: all 0.3s;
                            border-radius: 4px 4px 0 0;
                            color: #999;
                        }
                        .tab-btn.active {
                            background: #ffcc00;
                            color: #0a0a0a;
                        }
                        .tab-btn:hover:not(.active) {
                            background: #333;
                            color: #ffcc00;
                        }
                        .tab-content {
                            display: none;
                        }
                        .tab-content.active {
                            display: block;
                        }
                        .rank-1 { color: #FFD700; text-shadow: 0 0 10px rgba(255,215,0,0.5); }
                        .rank-2 { color: #C0C0C0; text-shadow: 0 0 10px rgba(192,192,192,0.5); }
                        .rank-3 { color: #CD7F32; text-shadow: 0 0 10px rgba(205,127,50,0.5); }
                        .score {
                            font-weight: bold;
                            color: #ffcc00;
                            text-align: right;
                        }
                        .level {
                            text-align: center;
                            color: #ff9933;
                            font-weight: bold;
                        }
                        .winner {
                            background: #ffcc00;
                            color: #0a0a0a;
                            padding: 2px 8px;
                            border-radius: 4px;
                            font-weight: bold;
                            font-size: 0.85em;
                            text-shadow: none;
                        }
                        .depth {
                            text-align: center;
                            color: #ff6666;
                            font-weight: bold;
                        }
                        .timestamp {
                            color: #666;
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
                            background: linear-gradient(135deg, #ffcc00 0%, #ff9933 100%);
                            color: #0a0a0a;
                            border: none;
                            border-radius: 25px;
                            cursor: pointer;
                            font-size: 1em;
                            font-weight: bold;
                            box-shadow: 0 4px 15px rgba(255, 204, 0, 0.3);
                            transition: transform 0.2s, box-shadow 0.2s;
                        }
                        .refresh-btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(255, 51, 51, 0.5);
                            background: linear-gradient(135deg, #ff3333 0%, #ff6666 100%);
                            color: white;
                        }
                    </style>
                    <meta http-equiv="refresh" content="30">
                </head>
                <body>
                    <div class="container">
                        <h1>🏆 Bakabakaband Leaderboard</h1>
                        <div class="subtitle">Total Scores: ${scores.length} | Auto-refreshes every 30 seconds</div>

                        ${
    scores.length === 0
        ? '<div class="no-scores">No scores yet. Be the first to submit!</div>'
        : `<table>
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
                                    ${scores
        .map((score, index) => {
            const rankClass =
                                          index === 0
                                              ? 'rank-1'
                                              : index === 1
                                                  ? 'rank-2'
                                                  : index === 2
                                                      ? 'rank-3'
                                                      : '';
            const date = new Date(score.timestamp);
            const winnerBadge = score.isWinner
                ? '<span class="winner">WINNER</span>'
                : '';
            return `
                                            <tr onclick='showModal(${JSON.stringify(score).replace(/'/g, '&#39;')})'>
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
        })
        .join('')}
                                </tbody>
                            </table>`
}

                        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Now</button>
                    </div>

                    <!-- Modal -->
                    <div id="scoreModal" class="modal" onclick="closeModalOnBackdrop(event)">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h2>📊 Complete Score Data</h2>
                                <span class="close" onclick="closeModal()">&times;</span>
                            </div>
                            <div class="modal-body">
                                <div class="tab-container">
                                    <div class="tab-buttons">
                                        <button class="tab-btn active" onclick="switchTab('status')">📊 ステータス</button>
                                        <button class="tab-btn" onclick="switchTab('json')">📄 JSON</button>
                                    </div>
                                    
                                    <div id="statusTab" class="tab-content active">
                                        <div id="statusDisplay"></div>
                                    </div>
                                    
                                    <div id="jsonTab" class="tab-content">
                                        <button class="copy-btn" onclick="copyJSON()">📋 Copy JSON to Clipboard</button>
                                        <div class="json-container">
                                            <pre id="jsonDisplay"></pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <script>
                        let currentScoreData = null;

                        function switchTab(tabName) {
                            // Update tab buttons
                            document.querySelectorAll('.tab-btn').forEach(btn => {
                                btn.classList.remove('active');
                            });
                            event.target.classList.add('active');
                            
                            // Update tab content
                            document.querySelectorAll('.tab-content').forEach(content => {
                                content.classList.remove('active');
                            });
                            document.getElementById(tabName + 'Tab').classList.add('active');
                        }

                        function showModal(scoreData) {
                            currentScoreData = scoreData;
                            const modal = document.getElementById('scoreModal');
                            const jsonDisplay = document.getElementById('jsonDisplay');
                            const statusDisplay = document.getElementById('statusDisplay');
                            
                            // Format JSON with syntax highlighting
                            jsonDisplay.innerHTML = syntaxHighlight(JSON.stringify(scoreData, null, 2));
                            
                            // Format status display
                            statusDisplay.innerHTML = formatStatusDisplay(scoreData);
                            
                            // Reset to status tab
                            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                            document.querySelector('.tab-btn').classList.add('active');
                            document.getElementById('statusTab').classList.add('active');
                            
                            modal.style.display = 'block';
                            document.body.style.overflow = 'hidden';
                        }

                        function formatStatusDisplay(data) {
                            const dump = data.dump || {};
                            const basic = dump.basic || {};
                            const status = dump.status || {};
                            const stats = dump.stats || [];
                            const death = dump.death || {};
                            
                            let html = '<div class="status-container">';
                            
                            // Basic Information Section
                            html += '<div class="status-section">';
                            html += '<h3>🎮 基本情報</h3>';
                            html += '<div class="status-grid">';
                            html += formatStatusItem('名前', basic.name || data.characterName || 'Unknown');
                            html += formatStatusItem('性別', basic.sex || '-');
                            html += formatStatusItem('種族', basic.race || data.race || 'Unknown');
                            html += formatStatusItem('職業', basic.class || data.class || 'Unknown');
                            html += formatStatusItem('年齢', basic.age ? basic.age + '才' : '-');
                            html += formatStatusItem('身長', basic.height ? basic.height + 'cm' : '-');
                            html += formatStatusItem('体重', basic.weight ? basic.weight + 'kg' : '-');
                            html += formatStatusItem('社会的地位', basic.prestige || '-');
                            html += formatStatusItem('性格', basic.personality || '-');
                            html += '</div>';
                            html += '</div>';
                            
                            // Stats Section
                            if (stats.length > 0) {
                                html += '<div class="status-section">';
                                html += '<h3>💪 能力値</h3>';
                                html += '<table class="stats-table">';
                                html += '<thead><tr>';
                                html += '<th>能力</th><th>現在値</th><th>最大値</th><th>使用値</th><th>最高値</th>';
                                html += '</tr></thead><tbody>';
                                
                                stats.forEach(stat => {
                                    html += '<tr>';
                                    html += \`<td><strong>\${stat.name}</strong></td>\`;
                                    html += \`<td>\${stat.current || '-'}</td>\`;
                                    html += \`<td>\${stat.max || '-'}</td>\`;
                                    html += \`<td>\${stat.use || '-'}</td>\`;
                                    html += \`<td>\${stat.top || '-'}</td>\`;
                                    html += '</tr>';
                                });
                                
                                html += '</tbody></table>';
                                html += '</div>';
                            }
                            
                            // Combat & Status Section
                            html += '<div class="status-section">';
                            html += '<h3>⚔️ 戦闘・ステータス</h3>';
                            html += '<div class="status-grid">';
                            html += formatStatusItem('レベル', basic.level || data.level || '1');
                            html += formatStatusItem('経験値', (basic.experience || data.experience || 0).toLocaleString());
                            html += formatStatusItem('最大経験値', (basic.max_experience || 0).toLocaleString());
                            html += formatStatusItem('HP', \`\${status.current_hitpoints || 0} / \${status.max_hitpoints || data.maxHp || 0}\`);
                            html += formatStatusItem('MP', \`\${status.current_mana || 0} / \${status.max_mana || 0}\`);
                            html += formatStatusItem('AC', status.armor_class || '-');
                            html += formatStatusItem('所持金', (status.gold || data.gold || 0).toLocaleString() + ' Au');
                            html += formatStatusItem('ダンジョンレベル', status.dungeon_level || data.dungeonLevel || '-');
                            html += '</div>';
                            html += '</div>';
                            
                            // Combat Details
                            if (dump.combat) {
                                const combat = dump.combat;
                                html += '<div class="status-section">';
                                html += '<h3>🗡️ 戦闘詳細</h3>';
                                html += '<div class="status-grid">';
                                html += formatStatusItem('打撃命中', combat.melee_hit || '-');
                                html += formatStatusItem('射撃命中', combat.ranged_hit || '-');
                                html += formatStatusItem('魔法防御', combat.magic_defense || '-');
                                html += formatStatusItem('隠密行動', combat.stealth || '-');
                                html += formatStatusItem('知覚', combat.perception || '-');
                                html += formatStatusItem('探索', combat.searching || '-');
                                html += formatStatusItem('解除', combat.disarming || '-');
                                html += formatStatusItem('魔法道具', combat.magic_device || '-');
                                html += '</div>';
                                html += '</div>';
                            }
                            
                            // Death Information
                            html += '<div class="status-section">';
                            html += '<h3>💀 死因・結果</h3>';
                            html += '<div class="status-grid">';
                            html += formatStatusItem('状態', death.is_winner || data.isWinner ? '🏆 勝利' : '💀 死亡');
                            html += formatStatusItem('死因', death.cause || data.deathCause || 'Unknown');
                            if (death.killer) {
                                html += formatStatusItem('殺害者', death.killer);
                            }
                            if (death.location) {
                                html += formatStatusItem('死亡場所', death.location);
                            }
                            html += '</div>';
                            html += '</div>';
                            
                            // Timestamp
                            html += '<div class="status-section">';
                            html += '<h3>📅 記録情報</h3>';
                            html += '<div class="status-grid">';
                            html += formatStatusItem('記録ID', data.id);
                            const date = new Date(data.timestamp);
                            html += formatStatusItem('記録日時', date.toLocaleString('ja-JP'));
                            html += formatStatusItem('ランク', data.rank || '-');
                            html += '</div>';
                            html += '</div>';
                            
                            html += '</div>';
                            return html;
                        }
                        
                        function formatStatusItem(label, value) {
                            return \`
                                <div class="status-item">
                                    <span class="status-label">\${label}:</span>
                                    <span class="status-value">\${value}</span>
                                </div>
                            \`;
                        }

                        function closeModal() {
                            const modal = document.getElementById('scoreModal');
                            modal.style.display = 'none';
                            document.body.style.overflow = 'auto';
                        }

                        function closeModalOnBackdrop(event) {
                            if (event.target.id === 'scoreModal') {
                                closeModal();
                            }
                        }

                        function copyJSON() {
                            if (!currentScoreData) return;

                            const jsonText = JSON.stringify(currentScoreData, null, 2);
                            navigator.clipboard.writeText(jsonText).then(() => {
                                const btn = event.target;
                                const originalText = btn.textContent;
                                btn.textContent = '✅ Copied!';
                                btn.style.background = '#45a049';
                                setTimeout(() => {
                                    btn.textContent = originalText;
                                    btn.style.background = '#4CAF50';
                                }, 2000);
                            }).catch(err => {
                                alert('Failed to copy: ' + err);
                            });
                        }

                        function syntaxHighlight(json) {
                            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(s*:)?|\b(true|false|null)\b|-?d+(?:.d*)?(?:[eE][+-]?d+)?)/g, function (match) {
                                let cls = 'json-number';
                                if (/^"/.test(match)) {
                                    if (/:$/.test(match)) {
                                        cls = 'json-key';
                                    } else {
                                        cls = 'json-string';
                                    }
                                } else if (/true|false/.test(match)) {
                                    cls = 'json-boolean';
                                } else if (/null/.test(match)) {
                                    cls = 'json-null';
                                }
                                return '<span class="' + cls + '">' + match + '</span>';
                            });
                        }

                        // Close modal on ESC key
                        document.addEventListener('keydown', function(event) {
                            if (event.key === 'Escape') {
                                closeModal();
                            }
                        });
                    </script>
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
        scores = scores.filter((s) => s.id !== id);

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
        console.log(
            `🎮 Bakabakaband Score Server running on http://localhost:${PORT}`,
        );
        console.log(`📊 View leaderboard at http://localhost:${PORT}/leaderboard`);
        console.log(`📤 Submit scores to http://localhost:${PORT}/submit`);
    });
}

startServer().catch(console.error);
