import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('正在清除 Guild Slash Commands...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: [] }
    );

    console.log('正在清除 Global Slash Commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: [] }
    );

    console.log('Slash Commands 已全部清除');
  } catch (error) {
    console.error(error);
  }
})();