import { Request, Response } from 'express';
import { Skill } from '../models/index.js';
import { generateId } from '../config/db.js';

export async function getSkills(req: Request, res: Response) {
  try {
    const { search, category } = req.query;

    const allSkills = await Skill.find({});

    let results = allSkills;

    if (category) {
      const cat = String(category).toLowerCase().trim();
      results = results.filter((s) => s.category?.toLowerCase().trim() === cat);
    }

    if (search) {
      const q = String(search).toLowerCase().trim();
      results = results.filter((s) => s.name?.toLowerCase().includes(q));
    }

    // Sort alphabetically by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    // Create grouped mapping
    const grouped: Record<string, string[]> = {};
    for (const item of results) {
      const cat = item.category || 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item.name);
    }

    return res.json({
      success: true,
      count: results.length,
      data: results,
      grouped,
    });
  } catch (err: any) {
    console.error('Error fetching skills:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch skills',
      error: err.message,
    });
  }
}

export async function createSkill(req: Request, res: Response) {
  try {
    const { name, category = 'General' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Skill name is required' });
    }

    const trimmedName = name.trim();
    const existing = await Skill.find({});
    const found = existing.find(
      (s) => s.name.toLowerCase().trim() === trimmedName.toLowerCase()
    );

    if (found) {
      return res.json({
        success: true,
        message: 'Skill already exists',
        data: found,
      });
    }

    const newSkill = await Skill.create({
      _id: generateId(),
      name: trimmedName,
      category: category.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      message: 'Skill created successfully',
      data: newSkill,
    });
  } catch (err: any) {
    console.error('Error creating skill:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create skill',
      error: err.message,
    });
  }
}
