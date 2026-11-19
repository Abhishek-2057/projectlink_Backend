import { Skill } from '../models/index.js';
import { generateId } from '../config/db.js';

export const INITIAL_SKILLS_CATEGORIES: { category: string; skills: string[] }[] = [
  {
    category: 'Tech & Data',
    skills: [
      'React.js',
      'React',
      'Node.js',
      'Express.js',
      'Python',
      'MongoDB',
      'PostgreSQL',
      'HTML',
      'Frontend Development',
      'TypeScript',
      'JavaScript',
      'Tailwind CSS',
      'Three.js',
      'REST APIs',
      'Docker',
      'Kubernetes',
      'C++',
      'Java',
      'Git',
      'GitHub',
      'Unreal Engine',
      'Blender 3D',
      'Autodesk Maya',
      'Search Engine Optimization (SEO)',
      'Google Analytics',
      'Google Search Console',
      'XML',
      'Database Management System (DBMS)',
      'ChatGPT',
    ],
  },
  {
    category: 'Marketing & Sales',
    skills: [
      'Social Media Marketing',
      'Digital Marketing',
      'Email Marketing',
      'Content Marketing',
      'LinkedIn Marketing',
      'Instagram Marketing',
      'Influencer Marketing',
      'Lead Generation',
      'Cold Calling',
      'Business Development',
      'Sales Strategy',
      'Field Sales',
      'Client Relationship Management (CRM)',
      'Public Relations',
    ],
  },
  {
    category: 'Writing & Content',
    skills: [
      'Content Writing',
      'Creative Writing',
      'Script Writing',
      'Copywriting/Blogging',
      'Proofreading',
      'Report Writing',
      'Content Editing',
      'Content Management',
      'Storytelling',
    ],
  },
  {
    category: 'Design & Video',
    skills: [
      'Video Editing',
      'Video Making',
      'Adobe Premiere Pro',
      'Final Cut Pro',
      'Adobe Creative Suite',
      'Animation',
      'Graphic Design',
      'UI & UX Design',
    ],
  },
  {
    category: 'Office & Business',
    skills: [
      'MS-Office',
      'MS-Excel',
      'MS-Word',
      'Business Analysis',
      'Business Research',
      'Market Analysis',
      'Financial Modeling',
      'Accounting',
      'Project Management',
      'Research and Analytics',
    ],
  },
  {
    category: 'Soft Skills & Languages',
    skills: [
      'Effective Communication',
      'English Proficiency (Spoken & Written)',
      'Hindi Proficiency (Spoken)',
      'Urdu Proficiency (Spoken & Written)',
      'Negotiation',
      'Counseling',
      'Time Management',
      'Problem Solving',
      'Analytical Thinking',
      'Presentation Skills',
      'Interpersonal Skills',
      'Public Speaking',
      'Networking',
      'Multitasking',
      'Attention to Detail',
      'Emotional Intelligence',
    ],
  },
  {
    category: 'Domain Specific',
    skills: [
      'Dietetics/Nutrition',
      'Psychology',
      'Social Work',
    ],
  },
];

export async function seedSkillsIfNeeded(): Promise<void> {
  try {
    const existing = await Skill.find({});
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase().trim()));

    const now = new Date().toISOString();
    let addedCount = 0;

    for (const group of INITIAL_SKILLS_CATEGORIES) {
      for (const skillName of group.skills) {
        const norm = skillName.toLowerCase().trim();
        if (!existingNames.has(norm)) {
          await Skill.create({
            _id: generateId(),
            name: skillName,
            category: group.category,
            createdAt: now,
            updatedAt: now,
          });
          existingNames.add(norm);
          addedCount++;
        }
      }
    }

    if (addedCount > 0) {
      console.log(` Seeded ${addedCount} skills into skills database collection.`);
    }
  } catch (err: any) {
    console.error('Error seeding skills:', err.message);
  }
}
