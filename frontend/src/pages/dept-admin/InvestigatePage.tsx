import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { AdminComplaintDetailPage } from '../shared/AdminComplaintDetailPage';

// The InvestigatePage is the same as AdminComplaintDetailPage but pre-selects the Assess tab
export function InvestigatePage() {
  return <AdminComplaintDetailPage />;
}
