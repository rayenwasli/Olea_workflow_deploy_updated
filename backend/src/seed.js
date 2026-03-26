const bcrypt = require('bcryptjs');
const { RoleName } = require('./utils/constants');
const { Role, User, Assureur } = require('./models');

async function seed() {
  // roles
  for (const rn of Object.values(RoleName)) {
    const [role] = await Role.findOrCreate({ where: { name: rn }, defaults: { name: rn } });
  }

  // default admin
  const adminEmail = 'admin@olea.tn';
  const existing = await User.findOne({ where: { email: adminEmail } });
  if (!existing) {
    const adminRole = await Role.findOne({ where: { name: RoleName.ADMIN } });
    const hash = await bcrypt.hash('Admin@1234', 10);

    const u = await User.create({
      email: adminEmail,
      password_hash: hash,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await u.setRoles([adminRole]);
  }

  // default assureurs (used in deposit form dropdown)
  const defaultAssureurs = [
    'STAR CHARGUIA',
    'MAGHREBIA',
    'GAT',
    'CTAMA',
    'BIAT ASSURANCES',
    'ZITOUNA TAKAFUL',
    'LA CARTE',
    'BH ASSURANCES',
    'LLOYD',
    'BRIDGE',
    'NEXT CARE',
    'COMAR',
    'STAR SFAX',
    'STAR SOUSSE',
    'STAR GABES',
    'STAR LAC 3',
  ];

  for (const name of defaultAssureurs) {
    // eslint-disable-next-line no-await-in-loop
    await Assureur.findOrCreate({ where: { name }, defaults: { name, enabled: true, created_at: new Date(), updated_at: new Date() } });
  }

}

module.exports = { seed };
