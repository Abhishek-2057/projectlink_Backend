import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { IParsedResume } from '../types/index.js';

/**
 * Extracts raw plain text from PDF, DOCX, or text files
 */
export async function extractResumeText(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName || filePath).toLowerCase();

  try {
    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);

      // Method 1: Check if pdf-parse is v2 Class (new PDFParse({ data }))
      if ((pdfParse as any).PDFParse) {
        try {
          const parser = new (pdfParse as any).PDFParse({ data: dataBuffer });
          const res = await parser.getText();
          if (res && res.text && res.text.trim().length > 0) {
            return res.text.trim();
          }
        } catch (v2Err) {
          console.warn('PDFParse v2 error, trying v1 fallback:', v2Err);
        }
      }

      // Method 2: Check if pdf-parse is v1 function (pdf(dataBuffer))
      const parseFn: any = typeof pdfParse === 'function' ? pdfParse : (pdfParse as any).default;
      if (typeof parseFn === 'function') {
        try {
          const data = await parseFn(dataBuffer);
          if (data && data.text && data.text.trim().length > 0) {
            return data.text.trim();
          }
        } catch (v1Err) {
          console.warn('PDFParse v1 error, trying text fallback:', v1Err);
        }
      }
    } else if (ext === '.docx' || ext === '.doc') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        if (result && result.value && result.value.trim().length > 0) {
          return result.value.trim();
        }
      } catch (docErr) {
        console.warn('Mammoth docx parse warning:', docErr);
      }
    }

    // Fallback: Read as text / binary string and filter printable characters
    const raw = fs.readFileSync(filePath, 'latin1');
    const matches = raw.match(/[\x20-\x7E\t\r\n]{4,}/g);
    if (matches && matches.length > 0) {
      const printable = matches.join(' ');
      if (printable.trim().length > 30) {
        return printable.trim();
      }
    }
  } catch (err: any) {
    console.error('Error extracting text from file:', err);
  }

  return '';
}

/**
 * System prompt definition adhering strictly to user requirements:
 * Only extract what is explicitly present. Never hallucinate or create fake data.
 */
const SYSTEM_PROMPT = `You are an expert resume parsing engine for "ProjectLink", an enterprise student project collaboration platform.

Your task is to analyze the text extracted from a student's uploaded resume (PDF or DOCX) and accurately map all relevant data into a structured JSON object.

Please extract and structure the information strictly according to the following JSON schema:

{
  "personal_information": {
    "full_name": "string",
    "professional_bio": "string (a summary only if a summary or bio is explicitly in the resume, otherwise empty string)"
  },
  "key_highlights": [
    "string (strictly 3 to 4 concise, impactful bullet points highlighting the candidate's core strengths, what they excel at, standout engineering skills, project impact, and academic strengths derived from the resume)"
  ],
  "academic_information": {
    "college_institute_name": "string",
    "degree_major": "string",
    "graduation_year": "string or number",
    "current_cgpa": "string or number"
  },
  "technical_stack_skills": {
    "skills": ["array", "of", "strings", "representing", "technical", "skills"]
  },
  "social_portfolio_links": {
    "github_profile_url": "string or null",
    "linkedin_url": "string or null",
    "personal_website": "string or null"
  },
  "additional_sections": {
    "career_objective": "string or null (ONLY if explicitly written in resume, otherwise null)",
    "work_experience": [
      {
        "company": "string",
        "role": "string",
        "duration": "string",
        "description": "string"
      }
    ],
    "extra_curricular_activities": ["string"],
    "trainings_courses": [
      {
        "title": "string",
        "organization": "string",
        "year": "string"
      }
    ],
    "academic_personal_projects": [
      {
        "project_name": "string",
        "description": "string",
        "tech_stack": ["string"]
      }
    ],
    "portfolio_work_samples": ["string"],
    "accomplishments_additional_details": ["string"]
  }
}

STRICT GUIDELINES:
1. Output ONLY valid JSON. Do not include markdown code block wrappers like \`\`\`json.
2. Extract ONLY the content that is explicitly present in the resume.
3. If a section or field is not present in the resume text, set its value to null (for strings) or [] (for arrays).
4. NEVER hallucinate, invent, or extrapolate data that is not in the resume text. For example, if there is no career objective section in the resume, set career_objective to null.
5. In 'key_highlights', analyze the student's skills, projects, internships, and education to generate strictly 3 to 4 professional, compelling bullet points highlighting what the student is best at, their core technical strengths, and practical engineering capabilities.`;

/**
 * Calls the AI model (Gemini) to structure the resume into the exact requested JSON format
 */
export async function parseResumeWithGemini(
  extractedText: string,
  userCustomApiKey?: string
): Promise<{ data: IParsedResume; usedAI: boolean; model?: string }> {
  const apiKey = userCustomApiKey || process.env.GEMINI_API_KEY;

  if (!extractedText || extractedText.trim().length === 0) {
    return {
      data: getEmptyParsedResume(),
      usedAI: false,
    };
  }

  if (apiKey) {
    const modelsToTry = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-4-hydrogen'];

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${SYSTEM_PROMPT}\n\nRESUME CONTENT:\n---\n${extractedText}\n---`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        });

        if (response.ok) {
          const resJson: any = await response.json();
          const rawOutput =
            resJson.candidates?.[0]?.content?.parts?.[0]?.text ||
            resJson.candidates?.[0]?.text;

          if (rawOutput) {
            const cleaned = rawOutput
              .replace(/```json/gi, '')
              .replace(/```/g, '')
              .trim();
            const parsed = JSON.parse(cleaned) as IParsedResume;
            return {
              data: sanitizeParsedResume(parsed),
              usedAI: true,
              model,
            };
          }
        }
      } catch (callErr) {
        // Network or model error, continue to next
      }
    }
  }

  // Robust heuristic extractor matching all 9 sections without hallucinations
  const heuristicData = fallbackHeuristicParse(extractedText);
  return {
    data: heuristicData,
    usedAI: false,
  };
}

function cleanBullet(str: string): string {
  return (str || '').replace(/^[•\-\*\s\x83ï§#\t]+/, '').trim();
}

/**
 * Intelligent section-based parser that maps the resume to the 9 profile sections.
 * Guarantees zero hallucinations: sections not in the text remain empty.
 */
export function fallbackHeuristicParse(text: string): IParsedResume {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Group text into sections
  const sectionMap: Record<string, string[]> = { HEADER: [] };
  let currentSec = 'HEADER';

  for (const line of lines) {
    // Skip pagination markers
    if (/--\s*\d+\s*of\s*\d+\s*--/i.test(line)) continue;

    if (/^(CAREER\s+OBJECTIVE|OBJECTIVE)/i.test(line)) {
      currentSec = 'CAREER_OBJECTIVE';
      sectionMap[currentSec] = [];
    } else if (/^EDUCATION/i.test(line)) {
      currentSec = 'EDUCATION';
      sectionMap[currentSec] = [];
    } else if (/^SKILLS/i.test(line)) {
      currentSec = 'SKILLS';
      sectionMap[currentSec] = [];
    } else if (/^(EXPERIENCES?|WORK\s+EXPERIENCE)/i.test(line)) {
      currentSec = 'EXPERIENCE';
      sectionMap[currentSec] = [];
    } else if (/^(PROJECTS?|ACADEMIC\s+PROJECTS|KEY\s+PROJECTS|PERSONAL\s+PROJECTS)/i.test(line)) {
      currentSec = 'PROJECTS';
      sectionMap[currentSec] = [];
    } else if (/^(CERTIFICATIONS?|TRAININGS?|COURSES)/i.test(line)) {
      currentSec = 'TRAININGS';
      sectionMap[currentSec] = [];
    } else if (/^(ACHIEVEMENTS|ACCOMPLISHMENTS|AWARDS)/i.test(line)) {
      currentSec = 'ACCOMPLISHMENTS';
      sectionMap[currentSec] = [];
    } else if (/^(EXTRACURRICULAR|EXTRA\s+CURRICULAR)/i.test(line)) {
      currentSec = 'EXTRACURRICULAR';
      sectionMap[currentSec] = [];
    } else {
      if (!sectionMap[currentSec]) sectionMap[currentSec] = [];
      sectionMap[currentSec].push(line);
    }
  }

  // 1. Full Name & Header
  let detectedName = '';
  const headerLines = sectionMap['HEADER'] || [];
  for (const hl of headerLines) {
    const clean = cleanBullet(hl);
    if (
      clean.length > 2 &&
      clean.length < 35 &&
      !clean.includes('@') &&
      !clean.includes('http') &&
      !/\+?\d{8,}/.test(clean) &&
      !/resume|curriculum|cv|contact|education|profile/i.test(clean)
    ) {
      detectedName = clean;
      break;
    }
  }

  // 2. Links & Phone
  const githubMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
  let githubUrl: string | null = null;
  if (githubMatch) {
    githubUrl = githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`;
  } else {
    // Check if handle is in header, e.g. § Abhishek-2057 or § \u00A7
    const ghHandleMatch = text.match(/(?:§|\u00A7|github(?:\.com)?[\s:/]+)\s*([a-zA-Z0-9_-]{3,})/i);
    if (ghHandleMatch && ghHandleMatch[1] && !/gmail|linkedin/i.test(ghHandleMatch[1])) {
      githubUrl = `https://github.com/${ghHandleMatch[1]}`;
    }
  }

  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  let linkedinUrl: string | null = null;
  if (linkedinMatch) {
    linkedinUrl = linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`;
  } else {
    const liHandleMatch = text.match(/(?:ï|\u00EF|linkedin(?:\.com)?[\s:/]+)\s*([a-zA-Z0-9_ -]{3,})/i);
    if (liHandleMatch && liHandleMatch[1]) {
      const slug = liHandleMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
      if (slug.length > 2 && !/gmail|github/i.test(slug)) {
        linkedinUrl = `https://linkedin.com/in/${slug}`;
      }
    }
  }

  let websiteUrl: string | null = null;
  const rawWebMatch = text.match(/(?:https?:\/\/)?([a-zA-Z0-9-]+\.(?:dev|me|io|in|com|org))(?:\/[^\s]*)?/i);
  if (rawWebMatch && !/gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|google\.com/i.test(rawWebMatch[1])) {
    websiteUrl = rawWebMatch[0].startsWith('http') ? rawWebMatch[0] : `https://${rawWebMatch[0]}`;
  }

  // 3. Career Objective: ONLY if explicitly in resume
  let careerObjective: string | null = null;
  const objLines = sectionMap['CAREER_OBJECTIVE'] || [];
  if (objLines.length > 0) {
    careerObjective = objLines.map(cleanBullet).join(' ').trim();
  }

  // 4. Education
  const eduLines = sectionMap['EDUCATION'] || [];
  let college = '';
  let degree = '';
  let cgpa: string | number = '';
  let gradYear: string | number = '';

  for (const el of eduLines) {
    const clean = cleanBullet(el);
    if (/(?:Institute|University|College|Technology|Engineering|Campus|BITS|IIT|NIT|VIT|IIIT)/i.test(clean)) {
      if (!college) {
        college = clean.replace(/^(?:at|from|education|degree|student at)\s*[:=-]?\s*/i, '').trim();
      }
    }
    const degMatch = clean.match(/\b(B\.?Tech|B\.?E\.?|BCA|MCA|M\.?Tech|B\.?Sc|Bachelor of Technology|Bachelor of Computer Applications)[A-Za-z\s,\-\.]*/i);
    if (degMatch && !degree) {
      degree = degMatch[0].trim().replace(/[:=].*$/, '').trim();
    }
    const cgMatch = clean.match(/(?:cgpa|cgpi|gpa|pointer|percentage)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (cgMatch && !cgpa) {
      cgpa = cgMatch[1];
    }
    const yearMatch = clean.match(/20\d{2}\s*[-–to]+\s*(20[2-3]\d)/i);
    if (yearMatch && !gradYear) {
      gradYear = yearMatch[1];
    } else {
      const singleYear = clean.match(/\b(202[4-9]|203[0-2])\b/);
      if (singleYear && !gradYear) {
        gradYear = singleYear[1];
      }
    }
  }

  // If not found in education lines, scan whole text
  if (!cgpa) {
    const wholeCgpa = text.match(/(?:cgpa|cgpi|gpa|pointer)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (wholeCgpa) cgpa = wholeCgpa[1];
  }
  if (!gradYear) {
    const rangeMatch = text.match(/20\d{2}\s*[-–to]+\s*(20[2-3]\d)/i);
    if (rangeMatch) gradYear = rangeMatch[1];
  }

  // 5. Technical Stack Skills: exact match from SKILLS section or catalog
  const TECH_CATALOG = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
    'React', 'React.js', 'Next.js', 'Vue', 'Angular', 'Node.js', 'Express', 'Express.js', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot',
    'HTML', 'HTML5', 'CSS', 'CSS3', 'Tailwind CSS', 'Tailwind', 'Bootstrap', 'Sass', 'Redux', 'Zustand',
    'MongoDB', 'MySQL', 'PostgreSQL', 'SQLite', 'Redis', 'Firebase', 'Prisma', 'Mongoose', 'Supabase', 'MinIO', 'Cloudinary',
    'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Linux', 'Git', 'GitHub', 'CI/CD Pipelines', 'CI/CD', 'Postman', 'REST APIs', 'REST API',
    'Data Structures & Algorithms', 'DSA', 'DBMS', 'Operating Systems', 'OS', 'Computer Networks', 'Networks',
    'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'Scikit-learn', 'OpenCV', 'NumPy', 'Pandas', 'Matplotlib'
  ];

  const detectedSkillsSet = new Set<string>();
  const skillLines = sectionMap['SKILLS'] || [];
  const skillTextToScan = skillLines.length > 0 ? skillLines.join('\n') : text;

  for (const tech of TECH_CATALOG) {
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (regex.test(skillTextToScan)) {
      detectedSkillsSet.add(tech);
    }
  }

  // 6. Work Experience
  const expLines = sectionMap['EXPERIENCE'] || [];
  const workExperience: { company: string; role: string; duration: string; description: string }[] = [];
  let currentExp: { company: string; role: string; duration: string; description: string } | null = null;

  for (const l of expLines) {
    const isHeader =
      l.includes('|') &&
      (/Intern|Developer|Engineer|Lead|Analyst|Consultant|Manager/i.test(l) || /20\d\d/.test(l));

    if (isHeader) {
      if (currentExp) workExperience.push(currentExp);
      const parts = l.split('|').map((s) => cleanBullet(s));
      const company = parts[0] || '';
      const role = parts[1] || '';
      const duration = parts[parts.length - 1] || '';
      currentExp = { company, role, duration, description: '' };
    } else if (currentExp) {
      const clean = cleanBullet(l);
      if (clean) {
        currentExp.description = currentExp.description ? `${currentExp.description}\n• ${clean}` : `• ${clean}`;
      }
    }
  }
  if (currentExp) workExperience.push(currentExp);

  // 7. Academic / Personal Projects
  const projLines = sectionMap['PROJECTS'] || [];
  const projects: { project_name: string; description: string; tech_stack: string[] }[] = [];
  let currentProj: { project_name: string; description: string; tech_stack: string[] } | null = null;

  for (const l of projLines) {
    const clean = cleanBullet(l);
    const isNewProject = l.startsWith('•') && (l.includes('(') || !currentProj);

    if (isNewProject) {
      if (currentProj) projects.push(currentProj);
      const titleMatch = clean.match(/^([^(]+)(?:\(([^)]+)\))?/);
      const name = titleMatch ? titleMatch[1].trim() : clean;
      const tech = titleMatch && titleMatch[2] ? titleMatch[2].split(',').map((s) => s.trim()) : [];
      currentProj = { project_name: name, tech_stack: tech, description: '' };
    } else if (currentProj) {
      if (clean) {
        currentProj.description = currentProj.description ? `${currentProj.description}\n• ${clean}` : `• ${clean}`;
      }
    }
  }
  if (currentProj) projects.push(currentProj);

  // 8. Trainings / Courses
  const trainLines = sectionMap['TRAININGS'] || [];
  const trainings_courses: { title: string; organization: string; year: string }[] = [];
  for (const l of trainLines) {
    const clean = cleanBullet(l);
    if (!clean) continue;
    const parts = clean.split(/[|–-]/).map((s) => s.trim());
    trainings_courses.push({
      title: parts[0] || clean,
      organization: parts[1] || '',
      year: parts.length > 2 ? parts[parts.length - 1] : '',
    });
  }

  // 9. Extra-Curricular Activities
  const extra_curricular_activities = (sectionMap['EXTRACURRICULAR'] || [])
    .map(cleanBullet)
    .filter((l) => l && !l.includes('--'));

  // 10. Accomplishments / Additional Details
  const accomplishments_additional_details = (sectionMap['ACCOMPLISHMENTS'] || [])
    .map(cleanBullet)
    .filter(Boolean);

  const skillsArr = Array.from(detectedSkillsSet);

  // Generate 3-4 key highlights from extracted resume data
  const heuristicHighlights: string[] = [];
  if (skillsArr.length > 0) {
    const topSkills = skillsArr.slice(0, 5).join(', ');
    heuristicHighlights.push(`Proficient in modern full-stack development with strong expertise in ${topSkills}.`);
  }
  if (projects.length > 0) {
    const projNames = projects.slice(0, 2).map((p) => p.project_name).join(' and ');
    heuristicHighlights.push(`Demonstrated practical experience architecting and deploying projects like ${projNames}.`);
  }
  if (workExperience.length > 0) {
    const roles = workExperience.map((w) => `${w.role} at ${w.company}`).slice(0, 2).join(', ');
    heuristicHighlights.push(`Proven real-world industry impact through internships: ${roles}.`);
  } else if (cgpa) {
    heuristicHighlights.push(`Consistent academic excellence with a ${cgpa} CGPA in ${degree || 'Engineering'}.`);
  }
  if (heuristicHighlights.length < 3 && (college || degree)) {
    heuristicHighlights.push(`Solid engineering foundation and collaborative problem-solving from ${college || 'engineering studies'}.`);
  }

  return {
    personal_information: {
      full_name: detectedName || '',
      professional_bio: '',
    },
    key_highlights: heuristicHighlights,
    academic_information: {
      college_institute_name: college,
      degree_major: degree,
      graduation_year: gradYear || '',
      current_cgpa: cgpa || '',
    },
    technical_stack_skills: {
      skills: skillsArr,
    },
    social_portfolio_links: {
      github_profile_url: githubUrl,
      linkedin_url: linkedinUrl,
      personal_website: websiteUrl,
    },
    additional_sections: {
      career_objective: careerObjective,
      work_experience: workExperience,
      extra_curricular_activities,
      trainings_courses,
      academic_personal_projects: projects,
      portfolio_work_samples: [],
      accomplishments_additional_details,
    },
  };
}

function getEmptyParsedResume(): IParsedResume {
  return {
    personal_information: { full_name: '', professional_bio: '' },
    key_highlights: [],
    academic_information: { college_institute_name: '', degree_major: '', graduation_year: '', current_cgpa: '' },
    technical_stack_skills: { skills: [] },
    social_portfolio_links: { github_profile_url: null, linkedin_url: null, personal_website: null },
    additional_sections: {
      career_objective: null,
      work_experience: [],
      extra_curricular_activities: [],
      trainings_courses: [],
      academic_personal_projects: [],
      portfolio_work_samples: [],
      accomplishments_additional_details: [],
    },
  };
}

function sanitizeParsedResume(data: any): IParsedResume {
  const rawHighlights = Array.isArray(data?.key_highlights)
    ? data.key_highlights
    : Array.isArray(data?.additional_sections?.key_highlights)
    ? data.additional_sections.key_highlights
    : [];

  const key_highlights = rawHighlights
    .map((h: any) => (typeof h === 'string' ? h.trim() : ''))
    .filter((h: string) => h.length > 0)
    .slice(0, 5);

  return {
    personal_information: {
      full_name: data?.personal_information?.full_name || '',
      professional_bio: data?.personal_information?.professional_bio || '',
    },
    key_highlights: key_highlights.length > 0 ? key_highlights : undefined,
    academic_information: {
      college_institute_name: data?.academic_information?.college_institute_name || '',
      degree_major: data?.academic_information?.degree_major || '',
      graduation_year: data?.academic_information?.graduation_year || '',
      current_cgpa: data?.academic_information?.current_cgpa || '',
    },
    technical_stack_skills: {
      skills: Array.isArray(data?.technical_stack_skills?.skills) ? data.technical_stack_skills.skills : [],
    },
    social_portfolio_links: {
      github_profile_url: data?.social_portfolio_links?.github_profile_url || null,
      linkedin_url: data?.social_portfolio_links?.linkedin_url || null,
      personal_website: data?.social_portfolio_links?.personal_website || null,
    },
    additional_sections: {
      career_objective: data?.additional_sections?.career_objective || null,
      work_experience: Array.isArray(data?.additional_sections?.work_experience) ? data.additional_sections.work_experience : [],
      extra_curricular_activities: Array.isArray(data?.additional_sections?.extra_curricular_activities) ? data.additional_sections.extra_curricular_activities : [],
      trainings_courses: Array.isArray(data?.additional_sections?.trainings_courses) ? data.additional_sections.trainings_courses : [],
      academic_personal_projects: Array.isArray(data?.additional_sections?.academic_personal_projects) ? data.additional_sections.academic_personal_projects : [],
      portfolio_work_samples: Array.isArray(data?.additional_sections?.portfolio_work_samples) ? data.additional_sections.portfolio_work_samples : [],
      accomplishments_additional_details: Array.isArray(data?.additional_sections?.accomplishments_additional_details) ? data.additional_sections.accomplishments_additional_details : [],
    },
  };
}
