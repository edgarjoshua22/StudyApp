// Adaptive wording by learner type — keeps the app friendly for pathfinders /
// kids and appropriate for students, all from one place. Pass profile.user_type.
export function words(userType) {
  const pathfinder = userType === 'pathfinder';
  return {
    unit: pathfinder ? 'topic' : 'subject',
    units: pathfinder ? 'topics' : 'subjects',
    Unit: pathfinder ? 'Topic' : 'Subject',
    Units: pathfinder ? 'Topics' : 'Subjects',
    newUnit: pathfinder ? 'New topic' : 'New subject',
    addFirst: pathfinder
      ? 'Add your first topic and start learning!'
      : 'Add your first subject and start a learning path!',
    heroSub: pathfinder ? 'What do you want to learn today?' : 'Ready to build your brain today?',
  };
}
